/// <reference types="jest" />
import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  const filter = new HttpExceptionFilter();
  const log = {
    warn: jest
      .spyOn(filter['logger'], 'warn')
      .mockImplementation(() => undefined),
    error: jest
      .spyOn(filter['logger'], 'error')
      .mockImplementation(() => undefined),
  };
  filter.catch(exception, host);
  const body = (json.mock.calls as unknown[][])[0][0] as {
    success: boolean;
    message: string;
    errors: string[];
  };
  const code = (status.mock.calls as unknown[][])[0][0] as number;
  return { code, body, raw: JSON.stringify(body), log };
}

/** A real Prisma error, exactly as the client throws it. */
function prismaError(code: string, message: string, target?: unknown) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'test',
    meta: target === undefined ? undefined : { target },
  });
}

describe('HttpExceptionFilter — duplicates (Prisma P2002) become 409 in Thai, never 500', () => {
  it.each([
    ['Employee_employeeCode_key', 'รหัสพนักงานนี้มีอยู่ในระบบแล้ว'],
    ['User_email_key', 'อีเมลนี้มีอยู่ในระบบแล้ว'],
    ['User_username_key', 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว'],
    ['Department_name_key', 'ชื่อแผนกนี้มีอยู่ในระบบแล้ว'],
    ['LeaveType_name_key', 'ชื่อประเภทการลานี้มีอยู่ในระบบแล้ว'],
    ['PublicHoliday_date_key', 'มีวันหยุดในวันที่นี้อยู่แล้ว'],
  ])('%s → 409 "%s"', (constraint, thai) => {
    const { code, body, raw } = run(
      prismaError(
        'P2002',
        `Unique constraint failed on the constraint: \`${constraint}\``,
        constraint,
      ),
    );
    expect(code).toBe(409);
    expect(body).toEqual({ success: false, message: thai, errors: [thai] });
    expect(raw).not.toContain(constraint);
    expect(raw).not.toContain('Unique constraint');
  });

  it('field-name targets are understood too', () => {
    const { code, body } = run(prismaError('P2002', 'dup', ['email']));
    expect(code).toBe(409);
    expect(body.message).toBe('อีเมลนี้มีอยู่ในระบบแล้ว');
  });

  it('an unknown constraint gets a generic Thai duplicate message', () => {
    const { code, body } = run(prismaError('P2002', 'dup', 'Something_key'));
    expect(code).toBe(409);
    expect(body.message).toBe('ข้อมูลนี้มีอยู่ในระบบแล้ว');
  });

  it('the details are still logged on the server for debugging', () => {
    const { log } = run(
      prismaError(
        'P2002',
        'Unique constraint failed on Employee_employeeCode_key',
        'Employee_employeeCode_key',
      ),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Employee_employeeCode_key'),
    );
  });
});

describe('HttpExceptionFilter — other Prisma errors', () => {
  it('record not found (P2025) → 404', () => {
    const { code, body } = run(
      prismaError(
        'P2025',
        'An operation failed because it depends on one or more records that were required but not found.',
      ),
    );
    expect(code).toBe(404);
    expect(body.message).toBe('ไม่พบข้อมูลที่ต้องการ');
  });

  it('still referenced (P2003, e.g. deleting a department that has employees) → 409', () => {
    const { code, body, raw } = run(
      prismaError(
        'P2003',
        'Foreign key constraint failed on the field: `Employee_departmentId_fkey`',
      ),
    );
    expect(code).toBe(409);
    expect(body.message).toBe(
      'ไม่สามารถดำเนินการได้ เนื่องจากข้อมูลนี้ถูกใช้งานอยู่',
    );
    expect(raw).not.toContain('fkey');
  });

  it('any other Prisma error → 500 with a generic message', () => {
    const { code, body, raw } = run(
      prismaError('P1001', "Can't reach database server at `db.internal:3306`"),
    );
    expect(code).toBe(500);
    expect(body.message).toBe('เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง');
    expect(raw).not.toContain('db.internal');
  });
});

describe('HttpExceptionFilter — unexpected errors never leak internals', () => {
  it.each([
    [
      'an Error',
      new Error(
        "Cannot read properties of undefined (reading 'id') at /srv/app/x.ts",
      ),
    ],
    ['a thrown string', 'raw secret string'],
    ['a plain object', { sql: 'SELECT * FROM users' }],
  ])(
    '%s → 500 generic message; details only in the server log',
    (_n, thrown) => {
      const { code, body, raw, log } = run(thrown);
      expect(code).toBe(500);
      expect(body).toEqual({
        success: false,
        message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
        errors: ['เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง'],
      });
      expect(raw).not.toMatch(/Cannot read|secret|SELECT/);
      expect(log.error).toHaveBeenCalled();
    },
  );
});

describe('HttpExceptionFilter — intentional HTTP errors are unchanged', () => {
  it('keeps the status and the service’s own message', () => {
    const { code, body } = run(new ForbiddenException('คุณไม่มีสิทธิ์'));
    expect(code).toBe(403);
    expect(body.message).toBe('คุณไม่มีสิทธิ์');
  });

  it('validation arrays: first message on top, all of them in errors', () => {
    const { code, body } = run(
      new BadRequestException([
        'email must be an email',
        'name should not be empty',
      ]),
    );
    expect(code).toBe(400);
    expect(body.message).toBe('email must be an email');
    expect(body.errors).toEqual([
      'email must be an email',
      'name should not be empty',
    ]);
  });

  it('the upload file-type rejection is a 400 with its Thai message', () => {
    const { code, body } = run(
      new BadRequestException(
        'ไม่รองรับประเภทไฟล์นี้ (รองรับเฉพาะ PDF, PNG, JPG)',
      ),
    );
    expect(code).toBe(400);
    expect(body.message).toBe(
      'ไม่รองรับประเภทไฟล์นี้ (รองรับเฉพาะ PDF, PNG, JPG)',
    );
  });

  it('413 keeps its friendly size message', () => {
    const { code } = run(new PayloadTooLargeException());
    expect(code).toBe(413);
  });

  it('Multer file-size errors become 413', () => {
    const err = Object.assign(new Error('File too large'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE',
    });
    expect(run(err).code).toBe(413);
  });
});

describe('HttpExceptionFilter — upload size limit is 2 MB, wording is accurate', () => {
  it('Multer file-size error → 413 "…ไม่เกิน 2 MB"', () => {
    const err = Object.assign(new Error('File too large'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE',
    });
    const { code, body } = run(err);
    expect(code).toBe(413);
    expect(body.message).toBe(
      'ไฟล์มีขนาดใหญ่เกินไป กรุณาเลือกไฟล์ขนาดไม่เกิน 2 MB',
    );
    expect(JSON.stringify(body)).not.toMatch(/10 ?MB|5 ?MB/);
  });

  it('a specific 413 message from our code is kept (not overwritten)', () => {
    const { code, body } = run(
      new PayloadTooLargeException(
        'ขนาดไฟล์รูปภาพใหญ่เกินกว่าที่ฐานข้อมูลจะรองรับได้ (แนะนำขนาดไม่เกิน 2 MB)',
      ),
    );
    expect(code).toBe(413);
    expect(body.message).toBe(
      'ขนาดไฟล์รูปภาพใหญ่เกินกว่าที่ฐานข้อมูลจะรองรับได้ (แนะนำขนาดไม่เกิน 2 MB)',
    );
  });

  it('Nest’s default 413 text is replaced by a Thai message', () => {
    expect(run(new PayloadTooLargeException()).body.message).toBe(
      'ข้อมูลที่ส่งมีขนาดใหญ่เกินไป',
    );
  });

  it('a request body over the JSON limit (body-parser) → 413, not 500', () => {
    const err = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    const { code, body } = run(err);
    expect(code).toBe(413);
    expect(body.message).toBe('ข้อมูลที่ส่งมีขนาดใหญ่เกินไป');
  });
});
