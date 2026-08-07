import { IsString, IsNotEmpty, IsDateString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLeaveRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  leaveTypeId: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  // leave mode specifies if it is full_day, half_day or hourly
  leaveMode?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  leaveDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  endTime?: string;

  @ApiPropertyOptional()
  @Min(0.5)
  @IsOptional()
  hours?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  period?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  startFormat?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  endFormat?: string;

  @ApiPropertyOptional()
  @Min(0.5)
  @IsOptional()
  totalDays?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  leaveHours?: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class UpdateLeaveRequestDto {
  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  leaveMode?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  leaveDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  endTime?: string;

  @ApiPropertyOptional()
  @Min(0.5)
  @IsOptional()
  hours?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  period?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  startFormat?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  endFormat?: string;

  @ApiPropertyOptional()
  @Min(0.5)
  @IsOptional()
  totalDays?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  leaveHours?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  leaveTypeId?: string;
}
