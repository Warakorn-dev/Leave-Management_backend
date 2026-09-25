import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { EmployeeMutationService } from './services/employee-mutation.service';
import { EmployeeQueryService } from './services/employee-query.service';
import {
  CreateLeaveRequestDto,
  UpdateLeaveRequestDto,
} from './dto/employee.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserPayload } from '../auth/types/current-user.type';

@ApiTags('Employee Leave Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Employee', 'Manager', 'HR', 'CEO') // Only actual employee roles
@Controller('leave')
export class EmployeeController {
  constructor(
    private readonly employeeMutationService: EmployeeMutationService,
    private readonly employeeQueryService: EmployeeQueryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new leave request' })
  createLeaveRequest(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.employeeMutationService.createLeaveRequest(user.id, dto);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get employee dashboard statistics' })
  getDashboardStats(
    @CurrentUser() user: CurrentUserPayload,
    @Query('year') year?: string,
  ) {
    return this.employeeQueryService.getDashboardStats(
      user.id,
      year ? parseInt(year) : undefined,
    );
  }

  @Get('types')
  @ApiOperation({ summary: 'Get all leave types' })
  getLeaveTypes() {
    return this.employeeQueryService.getLeaveTypes();
  }

  @Get('holidays')
  @ApiOperation({ summary: 'Get public holidays' })
  getPublicHolidays() {
    return this.employeeQueryService.getPublicHolidays();
  }

  @Get('day-availability')
  @ApiOperation({
    summary:
      'Per-day leave availability (which half is booked / free) for the current employee',
  })
  getDayAvailability(
    @CurrentUser() user: CurrentUserPayload,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('excludeRequestId') excludeRequestId?: string,
  ) {
    return this.employeeQueryService.getDayAvailability(
      user.id,
      startDate,
      endDate,
      excludeRequestId,
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Get leave history' })
  getLeaveHistory(@CurrentUser() user: CurrentUserPayload) {
    return this.employeeQueryService.getLeaveHistory(user.id);
  }

  @Get('all-leaves')
  @ApiOperation({ summary: 'Get all company leaves for calendar' })
  getAllCompanyLeaves() {
    return this.employeeQueryService.getAllCompanyLeaves();
  }

  @Get('department')
  @ApiOperation({ summary: 'Get leave history of the department' })
  getDepartmentLeaves(@CurrentUser() user: CurrentUserPayload) {
    return this.employeeQueryService.getDepartmentLeaves(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current employee details' })
  getMe(@CurrentUser() user: CurrentUserPayload) {
    return this.employeeQueryService.getMe(user.id);
  }

  @Patch('me/avatar')
  @ApiOperation({ summary: 'Update current employee avatar' })
  updateAvatar(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: { avatarUrl: string | null },
  ) {
    return this.employeeQueryService.updateAvatar(user.id, dto.avatarUrl);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Get leave balance' })
  getLeaveBalance(@CurrentUser() user: CurrentUserPayload) {
    return this.employeeQueryService.getLeaveBalance(user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a pending leave request' })
  updateLeaveRequest(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateLeaveRequestDto,
  ) {
    return this.employeeMutationService.updateLeaveRequest(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Cancel an active leave request; approved future leave requires HR cancellation approval',
  })
  deleteLeaveRequest(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.employeeMutationService.deleteLeaveRequest(user.id, id);
  }
}
