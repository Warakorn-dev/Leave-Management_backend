import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserRoleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  roleId: string;
}

export class ToggleUserStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean;
}

export class SettingDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}

export class UpdateSettingsDto {
  @ApiProperty({ type: [SettingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingDto)
  settings: SettingDto[];
}

export class PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  limit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  search?: string;
}
