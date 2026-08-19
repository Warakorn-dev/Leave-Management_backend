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

type MessageResponse = {
  message?: unknown;
  data?: unknown;
};

const isMessageResponse = (value: unknown): value is MessageResponse =>
  typeof value === 'object' && value !== null;

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => {
        const responseData = isMessageResponse(data) ? data : undefined;
        return {
          success: true,
          message:
            typeof responseData?.message === 'string'
              ? responseData.message
              : 'Request successful',
          data: (responseData?.data ?? data) as T,
        };
      }),
    );
  }
}
