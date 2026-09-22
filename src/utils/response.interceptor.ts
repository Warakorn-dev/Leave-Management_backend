import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  message: string;
  data: T;
}

interface RawHandlerResult<T> {
  message?: string;
  data?: T;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data: T | RawHandlerResult<T>) => {
        const raw = data as RawHandlerResult<T>;
        return {
          success: true,
          message: raw?.message || 'Request successful',
          data: raw?.data ?? (data as T), // If data contains { message, data }, extract it
        };
      }),
    );
  }
}
