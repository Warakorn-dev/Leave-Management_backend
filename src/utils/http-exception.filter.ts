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
      
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        message = 'ขนาดไฟล์ใหญ่เกินขีดจำกัด (สูงสุดไม่เกิน 10MB)';
        errors = [message];
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exception.message;
        errors =
          (exceptionResponse as any).errors ||
          (Array.isArray(message) ? message : [message]);
        if (Array.isArray(message)) {
          message = message[0];
        }
      } else {
        message = exception.message;
        errors = [message];
      }
    } else if (exception && (exception as any).name === 'MulterError') {
      const multerError = exception as any;
      if (multerError.code === 'LIMIT_FILE_SIZE') {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        message = 'ไฟล์มีขนาดใหญ่เกินไป (จำกัดไม่เกิน 10MB)';
        errors = [message];
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = `เกิดข้อผิดพลาดในการอัปโหลดไฟล์: ${multerError.message}`;
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
