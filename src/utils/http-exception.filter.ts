import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exception.message;
        errors = (exceptionResponse as any).errors || (Array.isArray(message) ? message : [message]);
        if (Array.isArray(message)) {
          message = message[0];
        }
      } else {
        message = exception.message;
        errors = [message];
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      errors = [exception.message];
    }

    response.status(status).json({
      success: false,
      message: typeof message === 'string' ? message : 'An error occurred',
      errors,
    });
  }
}
