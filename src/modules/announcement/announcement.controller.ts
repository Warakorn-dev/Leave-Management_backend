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
} from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('announcement')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Get()
  async getAnnouncements(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const data = await this.announcementService.findAll(parsedLimit);
    return { success: true, data };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HR', 'CEO')
  async createAnnouncement(
    @Body() body: { title: string; subtitle: string; isImportant: boolean },
  ) {
    const announcement = await this.announcementService.create(body);
    return { success: true, data: announcement };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HR', 'CEO')
  async updateAnnouncement(
    @Param('id') id: string,
    @Body() body: { title?: string; subtitle?: string; isImportant?: boolean },
  ) {
    const announcement = await this.announcementService.update(id, body);
    return { success: true, data: announcement };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HR', 'CEO')
  async deleteAnnouncement(@Param('id') id: string) {
    await this.announcementService.delete(id);
    return { success: true, message: 'Announcement deleted successfully' };
  }
}
