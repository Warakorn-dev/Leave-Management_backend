import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'manager123' })
  @IsString()
  username: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  captchaInput?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  captchaId?: string;
}

export class VerifyCaptchaDto {
  @ApiProperty({ example: '12345' })
  @IsString()
  @IsNotEmpty()
  captchaId: string;

  @ApiProperty({ example: 'C5War' })
  @IsString()
  @IsNotEmpty()
  captchaCode: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'manager123' })
  @IsString()
  username: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'newPassword123' })
  @IsString()
  @MinLength(6)
  newPassword: string;
}

// Every field is optional: a request may change only the password or only the phone.
// Names are NOT editable here (business rule 2026-09-24): only HR changes an
// employee's name. Sending firstName/lastName is rejected by the global
// ValidationPipe (forbidNonWhitelisted).
export class UpdateProfileDto {
  @ApiProperty({ example: '0812345678', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'newPassword123', required: false })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' })
  newPassword?: string;

  /** Older name for newPassword, still accepted. */
  @ApiProperty({ example: 'newPassword123', required: false })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' })
  password?: string;

  /** Required once the user has changed their password before. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
