import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/** Thai messages for each unique constraint (MySQL reports the constraint name). */
const UNIQUE_MESSAGES: Record<string, string> = {
  User_email_key: 'อีเมลนี้มีอยู่ในระบบแล้ว',
  User_username_key: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว',
  Employee_employeeCode_key: 'รหัสพนักงานนี้มีอยู่ในระบบแล้ว',
  Employee_userId_key: 'บัญชีผู้ใช้นี้ผูกกับพนักงานคนอื่นอยู่แล้ว',
  Department_name_key: 'ชื่อแผนกนี้มีอยู่ในระบบแล้ว',
  LeaveType_name_key: 'ชื่อประเภทการลานี้มีอยู่ในระบบแล้ว',
  LeaveType_code_key: 'รหัสประเภทการลานี้มีอยู่ในระบบแล้ว',
  PublicHoliday_date_key: 'มีวันหยุดในวันที่นี้อยู่แล้ว',
  Role_name_key: 'ชื่อสิทธิ์นี้มีอยู่ในระบบแล้ว',
  LeaveBalance_employeeId_leaveTypeId_year_key:
    'มีโควตาวันลาประเภทนี้ของปีนี้อยู่แล้ว',
  LeaveRequest_requestCode_key: 'รหัสคำขอลาซ้ำ กรุณาลองใหม่อีกครั้ง',
  LeaveRequestDay_leaveRequestId_date_key: 'มีวันลาซ้ำกันในคำขอเดียวกัน',
};
/** Fallback when Prisma reports field names instead of the constraint name. */
const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  email: UNIQUE_MESSAGES.User_email_key,
  username: UNIQUE_MESSAGES.User_username_key,
  employeeCode: UNIQUE_MESSAGES.Employee_employeeCode_key,
};
/** Upload limit shown to users; the real limit is set in upload.module.ts. */
const MAX_UPLOAD_LABEL = '2 MB';
const FILE_TOO_LARGE = `ไฟล์มีขนาดใหญ่เกินไป กรุณาเลือกไฟล์ขนาดไม่เกิน ${MAX_UPLOAD_LABEL}`;
const BODY_TOO_LARGE = 'ข้อมูลที่ส่งมีขนาดใหญ่เกินไป';
const GENERIC_DUPLICATE = 'ข้อมูลนี้มีอยู่ในระบบแล้ว';
const GENERIC_ERROR = 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง';

interface PrismaErrorLike {
  code: string;
  meta?: { target?: unknown };
}
/** Prisma known-request errors carry a code like "P2002". */
function isPrismaError(e: unknown): e is PrismaErrorLike {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    /^P\d{4}$/.test((e as { code: string }).code)
  );
}

function duplicateMessage(target: unknown): string {
  const parts = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];
  for (const p of parts) {
    if (UNIQUE_MESSAGES[p]) return UNIQUE_MESSAGES[p];
    if (UNIQUE_FIELD_MESSAGES[p]) return UNIQUE_FIELD_MESSAGES[p];
  }
  return GENERIC_DUPLICATE;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = GENERIC_ERROR;
    let errors: string[] = [];

    interface HttpExceptionBody {
      message?: string | string[];
      errors?: string[];
    }
    interface MulterErrorLike extends Error {
      code?: string;
    }

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        // Keep a specific Thai message set by our code; replace Nest's default text.
        message =
          exception.message && exception.message !== 'Payload Too Large'
            ? exception.message
            : BODY_TOO_LARGE;
        errors = [message];
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const body = exceptionResponse as HttpExceptionBody;
        message = body.message || exception.message;
        errors = body.errors || (Array.isArray(message) ? message : [message]);
        if (Array.isArray(message)) {
          message = message[0];
        }
      } else {
        message = exception.message;
        errors = [message];
      }
    } else if (exception instanceof Error && exception.name === 'MulterError') {
      const multerError = exception as MulterErrorLike;
      if (multerError.code === 'LIMIT_FILE_SIZE') {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        message = FILE_TOO_LARGE;
        errors = [message];
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = `เกิดข้อผิดพลาดในการอัปโหลดไฟล์: ${multerError.message}`;
        errors = [message];
      }
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { type?: unknown }).type === 'entity.too.large'
    ) {
      // express.json / urlencoded body over the 50mb limit (see main.ts)
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = BODY_TOO_LARGE;
      errors = [message];
    } else if (isPrismaError(exception)) {
      // Never forward Prisma/DB text (table, constraint and column names) to the client.
      this.logger.warn(
        `Prisma ${exception.code}: ${exception instanceof Error ? exception.message : ''}`,
      );
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = duplicateMessage(exception.meta?.target);
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'ไม่พบข้อมูลที่ต้องการ';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        message = 'ไม่สามารถดำเนินการได้ เนื่องจากข้อมูลนี้ถูกใช้งานอยู่';
      } else {
        message = GENERIC_ERROR;
      }
      errors = [message];
    } else {
      // Unexpected error: log the details server-side, send only a generic message.
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
      message = GENERIC_ERROR;
      errors = [message];
    }

    response.status(status).json({
      success: false,
      message: typeof message === 'string' ? message : 'An error occurred',
      errors,
    });
  }
}
