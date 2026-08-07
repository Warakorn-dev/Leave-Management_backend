import { Controller, Get, Put, Param, Body, UseGuards, Query } from '@nestjs/common';
import { CeoService } from './ceo.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('CEO Dashboard and Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CEO')
@Controller('ceo')
export class CeoController {
  constructor(private readonly ceoService: CeoService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get CEO Dashboard statistics' })
  getDashboardStats(@CurrentUser() user: any, @Query('year') year?: string) {
    return this.ceoService.getDashboardStats(user.id, year ? parseInt(year) : undefined);
  }

  @Get('report/company')
  @ApiOperation({ summary: 'Get overall company leave report' })
  getCompanyReport() {
    return this.ceoService.getCompanyReport();
  }

  @Get('report/stats')
  @ApiOperation({ summary: 'Get report statistics for CEO' })
  getReportStats() {
    return this.ceoService.getReportStats();
  }

  @Get('report/department')
  @ApiOperation({ summary: 'Get leave report by department' })
  getDepartmentReport(@Query('id') departmentId: string) {
    return this.ceoService.getDepartmentReport(departmentId);
  }

  @Put('approve/:id')
  @ApiOperation({ summary: 'CEO approve special leave request' })
  approveSpecialLeave(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('comment') comment: string,
  ) {
    return this.ceoService.approveSpecialLeave(user.id, id, 'Approve', comment);
  }

  @Put('reject/:id')
  @ApiOperation({ summary: 'CEO reject special leave request' })
  rejectSpecialLeave(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('comment') comment: string,
  ) {
    return this.ceoService.approveSpecialLeave(user.id, id, 'Reject', comment);
  }

  @Get('employees')
  @ApiOperation({ summary: 'Get all employees for CEO' })
  getEmployees() {
    return this.ceoService.findAllEmployees();
  }
}
