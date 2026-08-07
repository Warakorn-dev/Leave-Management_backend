import { Controller, Get, Post, Body, Put, Patch, Param, Delete, UseGuards, Request, Query } from '@nestjs/common';
import { HrService } from './hr.service';
import { CreateDepartmentDto, UpdateDepartmentDto, CreatePositionDto, UpdatePositionDto, CreateLeaveTypeDto, UpdateLeaveTypeDto, CreateEmployeeDto, UpdateEmployeeDto, CreatePublicHolidayDto, UpdatePublicHolidayDto, UpdateLeaveBalanceDto } from './dto/hr.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('HR Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('HR', 'CEO')
@Controller('hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get HR dashboard statistics' })
  getDashboardStats(@Request() req: any, @Query('year') year?: string) {
    return this.hrService.getDashboardStats(req.user.id, year ? parseInt(year) : undefined);
  }

  @Get('leave-summary')
  @ApiOperation({ summary: 'Get leave summary of all employees' })
  getLeaveSummary(
    @Query('searchQuery') searchQuery?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('leaveTypeId') leaveTypeId?: string,
    @Query('status') status?: string
  ) {
    return this.hrService.getLeaveSummary({ searchQuery, startDate, endDate, leaveTypeId, status });
  }

  // --- Departments ---
  @Post('departments')
  @ApiOperation({ summary: 'Create a new department' })
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.hrService.createDepartment(dto);
  }

  @Get('departments')
  @ApiOperation({ summary: 'Get all departments' })
  findAllDepartments() {
    return this.hrService.findAllDepartments();
  }

  @Put('departments/:id')
  @ApiOperation({ summary: 'Update a department' })
  updateDepartment(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.hrService.updateDepartment(id, dto);
  }

  @Delete('departments/:id')
  @ApiOperation({ summary: 'Delete a department' })
  deleteDepartment(@Param('id') id: string) {
    return this.hrService.deleteDepartment(id);
  }

  // --- Positions ---
  @Post('positions')
  @ApiOperation({ summary: 'Create a new position' })
  createPosition(@Body() dto: CreatePositionDto) {
    return this.hrService.createPosition(dto);
  }

  @Get('positions')
  @ApiOperation({ summary: 'Get all positions' })
  findAllPositions() {
    return this.hrService.findAllPositions();
  }

  @Put('positions/:id')
  @ApiOperation({ summary: 'Update a position' })
  updatePosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.hrService.updatePosition(id, dto);
  }

  @Delete('positions/:id')
  @ApiOperation({ summary: 'Delete a position' })
  deletePosition(@Param('id') id: string) {
    return this.hrService.deletePosition(id);
  }

  // --- Leave Types ---
  @Post('leave-types')
  @ApiOperation({ summary: 'Create a new leave type' })
  createLeaveType(@Body() dto: CreateLeaveTypeDto) {
    return this.hrService.createLeaveType(dto);
  }

  @Get('leave-types')
  @ApiOperation({ summary: 'Get all leave types' })
  findAllLeaveTypes() {
    return this.hrService.findAllLeaveTypes();
  }

  @Patch('leave-types/:id')
  @ApiOperation({ summary: 'Update a leave type' })
  updateLeaveType(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.hrService.updateLeaveType(id, dto);
  }

  @Delete('leave-types/:id')
  @ApiOperation({ summary: 'Delete a leave type' })
  deleteLeaveType(@Param('id') id: string) {
    return this.hrService.deleteLeaveType(id);
  }

  // --- Employees ---
  @Post('employees')
  @ApiOperation({ summary: 'Register a new employee and user' })
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.hrService.createEmployee(dto);
  }

  @Get('employees')
  @ApiOperation({ summary: 'Get all employees' })
  findAllEmployees() {
    return this.hrService.findAllEmployees();
  }

  @Get('employees/:id')
  @ApiOperation({ summary: 'Get employee by id' })
  findEmployeeById(@Param('id') id: string) {
    return this.hrService.findEmployeeById(id);
  }

  @Patch('employees/:id')
  @ApiOperation({ summary: 'Update an employee' })
  updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.hrService.updateEmployee(id, dto);
  }

  @Patch('employees/:id/status')
  @ApiOperation({ summary: 'Update employee status (active/inactive)' })
  updateEmployeeStatus(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.hrService.updateEmployeeStatus(id, isActive);
  }

  @Delete('employees/:id')
  @ApiOperation({ summary: 'Delete an employee (and their user account)' })
  deleteEmployee(@Param('id') id: string) {
    return this.hrService.deleteEmployee(id);
  }

  @Post('employees/:id/initialize-leave-balances')
  @ApiOperation({ summary: 'Initialize leave balances for an employee for the current year' })
  initializeLeaveBalances(@Param('id') id: string) {
    return this.hrService.initializeLeaveBalances(id);
  }

  @Post('employees/:id/reset-leave-balances')
  @ApiOperation({ summary: 'Reset leave balances for an employee (set usedDays to 0)' })
  resetLeaveBalances(@Param('id') id: string) {
    return this.hrService.resetLeaveBalances(id);
  }

  // --- Leaves ---
  @Get('leaves')
  @ApiOperation({ summary: 'Get all leave requests across the company' })
  findAllLeaves() {
    return this.hrService.findAllLeaves();
  }

  // --- Public Holidays ---
  @Post('holidays')
  @ApiOperation({ summary: 'Create a new public holiday' })
  createHoliday(@Body() dto: CreatePublicHolidayDto) {
    return this.hrService.createHoliday(dto);
  }

  @Get('holidays')
  @ApiOperation({ summary: 'Get all public holidays' })
  findAllHolidays() {
    return this.hrService.findAllHolidays();
  }

  @Put('holidays/:id')
  @ApiOperation({ summary: 'Update a public holiday' })
  updateHoliday(@Param('id') id: string, @Body() dto: UpdatePublicHolidayDto) {
    return this.hrService.updateHoliday(id, dto);
  }

  @Delete('holidays/:id')
  @ApiOperation({ summary: 'Delete a public holiday' })
  deleteHoliday(@Param('id') id: string) {
    return this.hrService.deleteHoliday(id);
  }

  // --- Leave Balance Adjustment ---
  @Put('leave-balances/:id')
  @ApiOperation({ summary: 'Manually adjust an employee leave balance' })
  updateLeaveBalance(@Param('id') id: string, @Body() dto: UpdateLeaveBalanceDto) {
    return this.hrService.updateLeaveBalance(id, dto);
  }
}
