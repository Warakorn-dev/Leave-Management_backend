import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { CreateLeaveRequestDto, UpdateLeaveRequestDto } from './dto/employee.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Employee Leave Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Employee', 'Manager', 'HR', 'CEO') // All can be employees
@Controller('leave')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new leave request' })
  createLeaveRequest(@CurrentUser() user: any, @Body() dto: CreateLeaveRequestDto) {
    return this.employeeService.createLeaveRequest(user.id, dto);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get employee dashboard statistics' })
  getDashboardStats(@CurrentUser() user: any, @Query('year') year?: string) {
    return this.employeeService.getDashboardStats(user.id, year ? parseInt(year) : undefined);
  }

  @Get('types')
  @ApiOperation({ summary: 'Get all leave types' })
  getLeaveTypes() {
    return this.employeeService.getLeaveTypes();
  }

  @Get('holidays')
  @ApiOperation({ summary: 'Get public holidays' })
  getPublicHolidays() {
    return this.employeeService.getPublicHolidays();
  }

  @Get('history')
  @ApiOperation({ summary: 'Get leave history' })
  getLeaveHistory(@CurrentUser() user: any) {
    return this.employeeService.getLeaveHistory(user.id);
  }

  @Get('all-leaves')
  @ApiOperation({ summary: 'Get all company leaves for calendar' })
  getAllCompanyLeaves() {
    return this.employeeService.getAllCompanyLeaves();
  }

  @Get('department')
  @ApiOperation({ summary: 'Get leave history of the department' })
  getDepartmentLeaves(@CurrentUser() user: any) {
    return this.employeeService.getDepartmentLeaves(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current employee details' })
  getMe(@CurrentUser() user: any) {
    return this.employeeService.getMe(user.id);
  }

  @Patch('me/avatar')
  @ApiOperation({ summary: 'Update current employee avatar' })
  updateAvatar(@CurrentUser() user: any, @Body() dto: { avatarUrl: string }) {
    return this.employeeService.updateAvatar(user.id, dto.avatarUrl);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Get leave balance' })
  getLeaveBalance(@CurrentUser() user: any) {
    return this.employeeService.getLeaveBalance(user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a pending leave request' })
  updateLeaveRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateLeaveRequestDto,
  ) {
    return this.employeeService.updateLeaveRequest(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a pending leave request' })
  deleteLeaveRequest(@CurrentUser() user: any, @Param('id') id: string) {
    return this.employeeService.deleteLeaveRequest(user.id, id);
  }
}
