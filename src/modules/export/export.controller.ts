import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ExportService } from './export.service';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Export Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CEO', 'HR') // Only CEO and HR can export full reports
@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('excel')
  @ApiOperation({ summary: 'Export leave requests to Excel' })
  exportExcel(@Res() res: Response) {
    return this.exportService.exportToExcel(res);
  }

  @Get('pdf')
  @ApiOperation({ summary: 'Export leave requests to PDF' })
  exportPdf(@Res() res: Response) {
    return this.exportService.exportToPDF(res);
  }
}
