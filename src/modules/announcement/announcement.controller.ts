import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Patch,
  Delete,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnnouncementService } from './announcement.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// Reading needs any logged-in user; only HR manages announcements
// (the only UI that writes them is /dashboard/hr/announcements).
@ApiTags('Announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('announcement')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Get()
  async getAnnouncements(@Query('limit') limit?: string) {
    try {
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      const data = await this.announcementService.findAll(parsedLimit);
      return { success: true, data };
    } catch {
      return { success: false, message: 'Failed to fetch announcements' };
    }
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('HR')
  async createAnnouncement(
    @Body()
    body: {
      title: string;
      subtitle: string;
      isImportant: boolean;
      attachmentData?: string | null;
      attachmentName?: string | null;
    },
  ) {
    try {
      const announcement = await this.announcementService.create(body);
      return { success: true, data: announcement };
    } catch (e) {
      if (e instanceof HttpException) throw e; // e.g. attachment over 5 MB
      return { success: false, message: 'Failed to create announcement' };
    }
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('HR')
  async updateAnnouncement(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      subtitle?: string;
      isImportant?: boolean;
      attachmentData?: string | null;
      attachmentName?: string | null;
    },
  ) {
    try {
      const announcement = await this.announcementService.update(id, body);
      return { success: true, data: announcement };
    } catch (e) {
      if (e instanceof HttpException) throw e; // e.g. attachment over 5 MB
      return { success: false, message: 'Failed to update announcement' };
    }
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('HR')
  async deleteAnnouncement(@Param('id') id: string) {
    try {
      await this.announcementService.delete(id);
      return { success: true, message: 'Announcement deleted successfully' };
    } catch {
      return { success: false, message: 'Failed to delete announcement' };
    }
  }
}
