import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  PaginationDto,
  UpdateSettingsDto,
  UpdateUserRoleDto,
  ToggleUserStatusDto,
} from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview statistics' })
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get('users')
  @ApiOperation({ summary: 'Get all users' })
  getUsers(@Query() query: PaginationDto) {
    return this.adminService.getUsers(query);
  }

  @Get('users/all')
  @ApiOperation({ summary: 'Get every user (read-only list, no pagination)' })
  getAllUsers() {
    return this.adminService.getAllUsers();
  }

  @Patch('users/:id/force-logout')
  @ApiOperation({ summary: 'Force a user to logout (revoke refresh token)' })
  forceLogout(@Param('id') id: string) {
    return this.adminService.forceLogout(id);
  }

  @Patch('users/:id/toggle-status')
  @ApiOperation({ summary: 'Activate or deactivate a user account' })
  toggleStatus(@Param('id') id: string, @Body() dto: ToggleUserStatusDto) {
    return this.adminService.toggleStatus(id, dto);
  }

  @Post('users/:id/reset-password')
  @ApiOperation({
    summary: 'Reset user password to a random temporary password',
  })
  resetPassword(@Param('id') id: string) {
    return this.adminService.resetPassword(id);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Change user role' })
  updateRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.adminService.updateRole(id, dto);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get system audit logs' })
  getAuditLogs(@Query() query: PaginationDto) {
    return this.adminService.getAuditLogs(query);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get system admin settings' })
  getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update system admin settings' })
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.adminService.updateSettings(dto);
  }

  @Get('system-health')
  @ApiOperation({ summary: 'Get system health info' })
  getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  @Get('audit-logs/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="audit-logs.csv"')
  @ApiOperation({ summary: 'Export system audit logs to CSV' })
  exportAuditLogs() {
    return this.adminService.exportAuditLogs();
  }

  @Get('captcha/stats')
  @ApiOperation({ summary: 'Get CAPTCHA statistics' })
  getCaptchaStats() {
    return this.adminService.getCaptchaStats();
  }

  @Delete('captcha/purge')
  @ApiOperation({ summary: 'Purge used and expired CAPTCHAs' })
  purgeCaptcha() {
    return this.adminService.purgeCaptcha();
  }

  @Get('roles')
  @ApiOperation({ summary: 'Get all roles with user counts' })
  getRoles() {
    return this.adminService.getRoles();
  }
}
