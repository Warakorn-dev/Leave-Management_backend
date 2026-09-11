import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
<<<<<<< HEAD
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
=======
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
>>>>>>> 5e1d8dfcd1ecc98e3ee8708e140219d5d2918252
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();

    // Check if user is authenticated
    const user = req.user;

<<<<<<< HEAD
    // We only log POST, PUT, PATCH, DELETE methods to keep it lightweight, unless explicitly needed
=======
    // We only log POST, PUT, PATCH, DELETE methods to keep it lightweight
>>>>>>> 5e1d8dfcd1ecc98e3ee8708e140219d5d2918252
    const method = req.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const url = req.url;
      const ipAddress = req.ip || req.headers['x-forwarded-for'];

      return next.handle().pipe(
<<<<<<< HEAD
        tap(() => {
          // Fire and forget logging
          let action = method;
          const entity = url.split('/')[2] || 'System'; // e.g. /api/users => users

          if (url.includes('/login')) action = 'LOGIN';
          else if (url.includes('/reset-password')) action = 'PASSWORD_RESET';

          this.prisma.auditLog
            .create({
              data: {
                userId: user ? user.id : null,
                action,
                entity,
                details: `URL: ${url}`,
                ipAddress:
                  typeof ipAddress === 'string'
                    ? ipAddress
                    : JSON.stringify(ipAddress),
              },
            })
            .catch((err) => {
              console.error('Failed to write audit log:', err);
            });
        }),
=======
        tap((responseData) => {
          this.logAction(req, user, method, url, ipAddress, responseData, false);
        }),
        catchError((err) => {
          this.logAction(req, user, method, url, ipAddress, null, true);
          return throwError(() => err);
        })
>>>>>>> 5e1d8dfcd1ecc98e3ee8708e140219d5d2918252
      );
    }

    return next.handle();
  }
<<<<<<< HEAD
=======

  private logAction(req: any, user: any, method: string, url: string, ipAddress: any, responseData: any, isError: boolean) {
    let action = method;
    const entity = url.split('/')[2] || 'System';

    if (url.includes('/login')) action = isError ? 'LOGIN_FAILED' : 'LOGIN';
    else if (url.includes('/reset-password')) action = isError ? 'PASSWORD_RESET_FAILED' : 'PASSWORD_RESET';
    else if (isError) action = `${method}_FAILED`;

    let resolvedUserId = user ? user.id : null;
    if (!resolvedUserId && action === 'LOGIN' && responseData?.user?.id) {
      resolvedUserId = responseData.user.id;
    }

    let details = `URL: ${url}`;
    if (url.includes('/login') && req.body) {
      const attemptedUser = req.body.username || req.body.email;
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
          ipAddress: typeof ipAddress === 'string' ? ipAddress : JSON.stringify(ipAddress),
        },
      })
      .catch((err) => {
        console.error('Failed to write audit log:', err);
      });
  }
>>>>>>> 5e1d8dfcd1ecc98e3ee8708e140219d5d2918252
}
