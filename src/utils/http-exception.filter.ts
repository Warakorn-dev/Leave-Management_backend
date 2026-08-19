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
    let message: string | string[] = 'Internal server error';
    let errors: unknown[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const errorResponse = exceptionResponse as Record<string, unknown>;
        const responseMessage = errorResponse.message;
        message =
          typeof responseMessage === 'string' || Array.isArray(responseMessage)
            ? responseMessage
            : exception.message;
        const responseErrors = errorResponse.errors;
        errors = Array.isArray(responseErrors)
          ? responseErrors
          : Array.isArray(message)
            ? message
            : [message];
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
