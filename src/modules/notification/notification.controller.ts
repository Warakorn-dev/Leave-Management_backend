import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  UseGuards,
  Request,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserPayload } from '../auth/types/current-user.type';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all notifications for current user' })
  async getNotifications(@CurrentUser() user: CurrentUserPayload) {
    try {
      return await this.notificationService.getNotifications(user.id);
    } catch (e) {
      this.logger.error('Failed to fetch notifications', e);
      throw new InternalServerErrorException(
        e instanceof Error ? e.message : 'Unknown error',
      );
    }
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.notificationService.markAsRead(id, user.id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read (POST)' })
  markAllAsReadPost(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationService.markAllAsRead(user.id);
  }

  @Patch('readAll')
  @ApiOperation({ summary: 'Mark all notifications as read (PATCH)' })
  markAllAsReadPatch(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationService.markAllAsRead(user.id);
  }
}
