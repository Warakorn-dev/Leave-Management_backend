import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProcessLeaveRequestDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  comment?: string;
}
