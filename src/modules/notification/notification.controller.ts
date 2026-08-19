import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all notifications for current user' })
  async getNotifications(@CurrentUser() user: AuthenticatedUser) {
    try {
      return await this.notificationService.getNotifications(user.id);
    } catch (e) {
      console.error('NOTIFICATION API ERROR:', e);
      throw e;
    }
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationService.markAsRead(id, user.id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read (POST)' })
  markAllAsReadPost(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationService.markAllAsRead(user.id);
  }

  @Patch('readAll')
  @ApiOperation({ summary: 'Mark all notifications as read (PATCH)' })
  markAllAsReadPatch(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationService.markAllAsRead(user.id);
  }
}
