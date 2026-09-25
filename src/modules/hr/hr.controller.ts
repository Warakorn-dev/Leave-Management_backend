import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { HrOrgService } from './services/hr-org.service';
import { HrEmployeeService } from './services/hr-employee.service';
import { HrDashboardService } from './services/hr-dashboard.service';
import { HrLeaveVerificationService } from './services/hr-leave-verification.service';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreatePositionDto,
  UpdatePositionDto,
  CreateLeaveTypeDto,
  UpdateLeaveTypeDto,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  CreatePublicHolidayDto,
  UpdatePublicHolidayDto,
  UpdateLeaveBalanceDto,
} from './dto/hr.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserPayload } from '../auth/types/current-user.type';

@ApiTags('HR Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
// Business rule (2026-09-24): HR only. The CEO may READ the three lists its own
// pages use (leaves, employees, departments) — see the method-level @Roles below.
@Roles('HR')
@Controller('hr')
export class HrController {
  constructor(
    private readonly hrOrgService: HrOrgService,
    private readonly hrEmployeeService: HrEmployeeService,
    private readonly hrDashboardService: HrDashboardService,
    private readonly hrLeaveVerificationService: HrLeaveVerificationService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get HR dashboard statistics' })
  getDashboardStats(
    @CurrentUser() user: CurrentUserPayload,
    @Query('year') year?: string,
  ) {
    return this.hrDashboardService.getDashboardStats(
      user.id,
      year ? parseInt(year) : undefined,
    );
  }

  @Get('leave-summary')
  @ApiOperation({ summary: 'Get leave summary of all employees' })
  getLeaveSummary(
    @Query('searchQuery') searchQuery?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('leaveTypeId') leaveTypeId?: string,
    @Query('status') status?: string,
  ) {
    return this.hrDashboardService.getLeaveSummary({
      searchQuery,
      startDate,
      endDate,
      leaveTypeId,
      status,
    });
  }

  // --- Departments ---
  @Post('departments')
  @ApiOperation({ summary: 'Create a new department' })
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.hrOrgService.createDepartment(dto);
  }

  @Get('departments')
  @Roles('HR', 'CEO') // CEO read-only: dashboard / report
  @ApiOperation({ summary: 'Get all departments' })
  findAllDepartments() {
    return this.hrOrgService.findAllDepartments();
  }

  @Put('departments/:id')
  @ApiOperation({ summary: 'Update a department' })
  updateDepartment(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.hrOrgService.updateDepartment(id, dto);
  }

  @Delete('departments/:id')
  @ApiOperation({ summary: 'Delete a department' })
  deleteDepartment(@Param('id') id: string) {
    return this.hrOrgService.deleteDepartment(id);
  }

  // --- Roles ---
  @Get('roles')
  @ApiOperation({ summary: 'Get all roles' })
  findAllRoles() {
    return this.hrOrgService.findAllRoles();
  }

  // --- Positions ---
  @Post('positions')
  @ApiOperation({ summary: 'Create a new position' })
  createPosition(@Body() dto: CreatePositionDto) {
    return this.hrOrgService.createPosition(dto);
  }

  @Get('positions')
  @ApiOperation({ summary: 'Get all positions' })
  findAllPositions() {
    return this.hrOrgService.findAllPositions();
  }

  @Put('positions/:id')
  @ApiOperation({ summary: 'Update a position' })
  updatePosition(@Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.hrOrgService.updatePosition(id, dto);
  }

  @Delete('positions/:id')
  @ApiOperation({ summary: 'Delete a position' })
  deletePosition(@Param('id') id: string) {
    return this.hrOrgService.deletePosition(id);
  }

  // --- Leave Types ---
  @Post('leave-types')
  @ApiOperation({ summary: 'Create a new leave type' })
  createLeaveType(@Body() dto: CreateLeaveTypeDto) {
    return this.hrOrgService.createLeaveType(dto);
  }

  @Get('leave-types')
  @ApiOperation({ summary: 'Get all leave types' })
  findAllLeaveTypes() {
    return this.hrOrgService.findAllLeaveTypes();
  }

  @Patch('leave-types/:id')
  @ApiOperation({ summary: 'Update a leave type' })
  updateLeaveType(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.hrOrgService.updateLeaveType(id, dto);
  }

  @Delete('leave-types/:id')
  @ApiOperation({ summary: 'Delete a leave type' })
  deleteLeaveType(@Param('id') id: string) {
    return this.hrOrgService.deleteLeaveType(id);
  }

  // --- Employees ---
  @Post('employees')
  @ApiOperation({ summary: 'Register a new employee and user' })
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.hrEmployeeService.createEmployee(dto);
  }

  @Get('employees')
  @Roles('HR', 'CEO') // CEO read-only: dashboard / report
  @ApiOperation({ summary: 'Get all employees' })
  findAllEmployees() {
    return this.hrEmployeeService.findAllEmployees();
  }

  @Get('employees/:id')
  @ApiOperation({ summary: 'Get employee by id' })
  findEmployeeById(@Param('id') id: string) {
    return this.hrEmployeeService.findEmployeeById(id);
  }

  @Patch('employees/:id')
  @ApiOperation({ summary: 'Update an employee' })
  updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.hrEmployeeService.updateEmployee(id, dto);
  }

  @Patch('employees/:id/status')
  @ApiOperation({ summary: 'Update employee status (active/inactive)' })
  updateEmployeeStatus(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.hrEmployeeService.updateEmployeeStatus(id, isActive);
  }

  @Delete('employees/:id')
  @ApiOperation({ summary: 'Delete an employee (and their user account)' })
  deleteEmployee(@Param('id') id: string) {
    return this.hrEmployeeService.deleteEmployee(id);
  }

  @Post('employees/:id/initialize-leave-balances')
  @ApiOperation({
    summary: 'Initialize leave balances for an employee for the current year',
  })
  initializeLeaveBalances(@Param('id') id: string) {
    return this.hrEmployeeService.initializeLeaveBalances(id);
  }

  @Post('employees/:id/reset-leave-balances')
  @ApiOperation({
    summary: 'Reset leave balances for an employee (set usedDays to 0)',
  })
  resetLeaveBalances(@Param('id') id: string) {
    return this.hrEmployeeService.resetLeaveBalances(id);
  }

  // --- Leaves ---
  @Get('leaves')
  @Roles('HR', 'CEO') // CEO read-only: calendar / dashboard / report
  @ApiOperation({ summary: 'Get all leave requests across the company' })
  findAllLeaves() {
    return this.hrDashboardService.findAllLeaves();
  }

  @Get('leaves/pending-verify')
  @ApiOperation({ summary: 'Get all pending verify leave requests' })
  getPendingVerify(@CurrentUser() user: CurrentUserPayload) {
    return this.hrLeaveVerificationService.getPendingVerify(user.id);
  }

  @Put('leaves/:id/verify')
  @ApiOperation({ summary: 'Verify (Approve) or Reject a leave request' })
  processLeaveRequest(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body('action') action: 'Approve' | 'Reject',
    @Body('comment') comment?: string,
  ) {
    return this.hrLeaveVerificationService.processLeaveRequest(
      user.id,
      id,
      action,
      {
        comment,
      },
    );
  }

  @Patch('leaves/:id/view')
  @ApiOperation({ summary: 'Mark a leave request as viewed by HR' })
  markAsViewed(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query('lock') lock?: string,
  ) {
    const shouldLock = lock !== 'false';
    return this.hrLeaveVerificationService.markAsViewed(
      user.id,
      id,
      shouldLock,
    );
  }

  // --- Public Holidays ---
  @Post('holidays')
  @ApiOperation({ summary: 'Create a new public holiday' })
  createHoliday(@Body() dto: CreatePublicHolidayDto) {
    return this.hrOrgService.createHoliday(dto);
  }

  @Get('holidays')
  @ApiOperation({ summary: 'Get all public holidays' })
  findAllHolidays() {
    return this.hrOrgService.findAllHolidays();
  }

  @Put('holidays/:id')
  @ApiOperation({ summary: 'Update a public holiday' })
  updateHoliday(@Param('id') id: string, @Body() dto: UpdatePublicHolidayDto) {
    return this.hrOrgService.updateHoliday(id, dto);
  }

  @Delete('holidays/:id')
  @ApiOperation({ summary: 'Delete a public holiday' })
  deleteHoliday(@Param('id') id: string) {
    return this.hrOrgService.deleteHoliday(id);
  }

  // --- Leave Balance Adjustment ---
  @Put('leave-balances/:id')
  @ApiOperation({ summary: 'Manually adjust an employee leave balance' })
  updateLeaveBalance(
    @Param('id') id: string,
    @Body() dto: UpdateLeaveBalanceDto,
  ) {
    return this.hrEmployeeService.updateLeaveBalance(id, dto);
  }
}
