import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../modules/auth/types/current-user.type';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();

    // Check if user is authenticated
    const user = req.user as CurrentUser | undefined;

    // We only log POST, PUT, PATCH, DELETE methods to keep it lightweight
    const method = req.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const url = req.url;
      const ipAddress = req.ip || req.headers['x-forwarded-for'];

      return next.handle().pipe(
        tap((responseData: { user?: { id?: string } } | null) => {
          this.logAction(
            req,
            user,
            method,
            url,
            ipAddress,
            responseData,
            false,
          );
        }),
        catchError((err: unknown) => {
          this.logAction(req, user, method, url, ipAddress, null, true);
          return throwError(() => err);
        }),
      );
    }

    return next.handle();
  }

  private logAction(
    req: Request,
    user: CurrentUser | undefined,
    method: string,
    url: string,
    ipAddress: string | string[] | undefined,
    responseData: { user?: { id?: string } } | null,
    isError: boolean,
  ) {
    let action = method;
    const entity = url.split('/')[2] || 'System';

    if (url.includes('/login')) action = isError ? 'LOGIN_FAILED' : 'LOGIN';
    else if (url.includes('/reset-password'))
      action = isError ? 'PASSWORD_RESET_FAILED' : 'PASSWORD_RESET';
    else if (isError) action = `${method}_FAILED`;

    let resolvedUserId: string | null = user ? user.id : null;
    if (!resolvedUserId && action === 'LOGIN' && responseData?.user?.id) {
      resolvedUserId = responseData.user.id;
    }

    let details = `URL: ${url}`;
    const body = req.body as Record<string, string> | undefined;
    if (url.includes('/login') && body) {
      const attemptedUser = body.username || body.email;
      if (attemptedUser) {
        details += ` | Username: ${attemptedUser}`;
      }
    }

    this.prisma.auditLog
      .create({
        data: {
          userId: resolvedUserId,
          action,
          entity,
          details,
          ipAddress:
            typeof ipAddress === 'string'
              ? ipAddress
              : JSON.stringify(ipAddress),
        },
      })
      .catch((err) => {
        console.error('Failed to write audit log:', err);
      });
  }
}
