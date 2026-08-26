import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();

    // Check if user is authenticated
    const user = req.user;

    // We only log POST, PUT, PATCH, DELETE methods to keep it lightweight, unless explicitly needed
    const method = req.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const url = req.url;
      const ipAddress = req.ip || req.headers['x-forwarded-for'];

      return next.handle().pipe(
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
      );
    }

    return next.handle();
  }
}
