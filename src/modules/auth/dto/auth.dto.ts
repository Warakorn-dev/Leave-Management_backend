import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
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

export class UpdateProfileDto {
  @ApiProperty({ example: 'สมศักดิ์', required: false })
  @IsString()
  firstName?: string;

  @ApiProperty({ example: 'พนักงานดีเด่น', required: false })
  @IsString()
  lastName?: string;

  @ApiProperty({ example: '0812345678', required: false })
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'newPassword123', required: false })
  @IsString()
  @MinLength(6)
  password?: string;
}
