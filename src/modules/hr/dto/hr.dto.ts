import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Department DTOs
export class CreateDepartmentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;
}

// Position DTOs
export class CreatePositionDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  roleId?: string;
}

export class UpdatePositionDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  roleId?: string;
}

// LeaveType DTOs
export class CreateLeaveTypeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsInt()
  defaultDays: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  requiresCertificate?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isSpecial?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  advanceNoticeDays?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  minTenureDays?: number;
}

export class UpdateLeaveTypeDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  defaultDays?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  requiresCertificate?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isSpecial?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  advanceNoticeDays?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  minTenureDays?: number;
}

// Employee DTOs
export class CreateEmployeeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  firstNameEN?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  lastNameEN?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  idCardNumber?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  idCardAddress?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currentAddress?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  departmentId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  positionId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  roleId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  roleName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  employeeCode?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  hireDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  gender?: string;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  employeeCode?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  firstNameEN?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  lastNameEN?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  idCardNumber?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  idCardAddress?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currentAddress?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  positionId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  hireDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  roleId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  roleName?: string;
}

// Public Holiday DTOs
export class CreatePublicHolidayDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  date: string;
}

export class UpdatePublicHolidayDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  date?: string;
}

// LeaveBalance DTOs
export class UpdateLeaveBalanceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  remainingDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  totalDays?: number;
}
