import { Controller, Get, Patch, Post, Param, UseGuards, Request } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all notifications for current user' })
  getNotifications(@CurrentUser() user: any) {
    return this.notificationService.getNotifications(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.notificationService.markAsRead(id, user.id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read (POST)' })
  markAllAsReadPost(@CurrentUser() user: any) {
    return this.notificationService.markAllAsRead(user.id);
  }

  @Patch('readAll')
  @ApiOperation({ summary: 'Mark all notifications as read (PATCH)' })
  markAllAsReadPatch(@CurrentUser() user: any) {
    return this.notificationService.markAllAsRead(user.id);
  }
}
