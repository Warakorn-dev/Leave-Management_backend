import { Controller, Get, Put, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ManagerService } from './manager.service';
import { ProcessLeaveRequestDto } from './dto/manager.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Manager Leave Processing Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Manager', 'CEO')
@Controller('manager')
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get manager dashboard statistics' })
  getDashboardStats(@CurrentUser() user: any, @Query('year') year?: string) {
    return this.managerService.getDashboardStats(user.id, year ? parseInt(year) : undefined);
  }

  @Get('pending')
  @ApiOperation({ summary: 'Get pending leave requests for the department' })
  getPendingRequests(@CurrentUser() user: any) {
    return this.managerService.getPendingRequests(user.id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get leave history for the department' })
  getDepartmentHistory(@CurrentUser() user: any) {
    return this.managerService.getDepartmentHistory(user.id);
  }

  @Put('approve/:id')
  @ApiOperation({ summary: 'Approve a leave request' })
  approveRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ProcessLeaveRequestDto,
  ) {
    return this.managerService.processRequest(user.id, id, 'Approve', dto);
  }

  @Put('reject/:id')
  @ApiOperation({ summary: 'Reject a leave request' })
  rejectRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ProcessLeaveRequestDto,
  ) {
    return this.managerService.processRequest(user.id, id, 'Reject', dto);
  }
}
