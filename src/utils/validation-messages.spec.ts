/// <reference types="jest" />
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { thaiValidationExceptionFactory } from './validation-messages';

class SampleDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  remainingDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @MinLength(6, { message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' })
  newPassword?: string;

  @IsOptional()
  @IsString()
  unlistedField?: string;
}

/** Same options as main.ts. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: thaiValidationExceptionFactory,
});

async function messagesFor(body: Record<string, unknown>): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype: SampleDto });
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse()['message'] as string[];
  }
  throw new Error('expected a validation error');
}

describe('[D-05] Thai validation messages', () => {
  it('empty / wrong-type fields get Thai messages with Thai field names', async () => {
    const msgs = await messagesFor({ reason: '', startDate: 'abc' });
    expect(msgs).toEqual(
      expect.arrayContaining([
        'กรุณากรอกเหตุผล',
        'วันที่เริ่มต้นไม่ใช่วันที่ที่ถูกต้อง',
      ]),
    );
  });

  it('numbers, e-mail and booleans', async () => {
    const msgs = await messagesFor({
      reason: 'x',
      startDate: '2026-10-14',
      email: 'not-an-email',
      remainingDays: -1,
      isActive: 'yes',
    });
    expect(msgs).toEqual(
      expect.arrayContaining([
        'รูปแบบอีเมลไม่ถูกต้อง',
        'วันลาคงเหลือต้องไม่น้อยกว่า 0',
        'สถานะการใช้งานต้องเป็นค่าจริงหรือเท็จ',
      ]),
    );
  });

  it('a Thai message already written on the DTO is kept as is', async () => {
    const msgs = await messagesFor({
      reason: 'x',
      startDate: '2026-10-14',
      newPassword: '123',
    });
    expect(msgs).toEqual(['รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร']);
  });

  it('an unknown extra field is refused in Thai; an unlisted field keeps its own name', async () => {
    const msgs = await messagesFor({
      reason: 'x',
      startDate: '2026-10-14',
      hacker: 1,
      unlistedField: 5,
    });
    expect(msgs).toEqual(
      expect.arrayContaining([
        'ไม่อนุญาตให้ส่งข้อมูล "hacker"',
        'unlistedFieldต้องเป็นข้อความ',
      ]),
    );
  });

  it('no English message ever reaches the user', async () => {
    const msgs = await messagesFor({
      startDate: 1,
      email: 2,
      remainingDays: 'x',
    });
    for (const m of msgs) expect(m).toMatch(/[\u0E00-\u0E7F]/);
  });
});
