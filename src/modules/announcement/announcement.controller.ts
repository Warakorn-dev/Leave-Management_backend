import { Controller, Get, Post, Body, Query, Param, Patch, Delete } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';

@Controller('announcement')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Get()
  async getAnnouncements(@Query('limit') limit?: string) {
    try {
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      const data = await this.announcementService.findAll(parsedLimit);
      return { success: true, data };
    } catch (error) {
      return { success: false, message: 'Failed to fetch announcements' };
    }
  }

  @Post()
  async createAnnouncement(@Body() body: { title: string; subtitle: string; isImportant: boolean }) {
    try {
      const announcement = await this.announcementService.create(body);
      return { success: true, data: announcement };
    } catch (error) {
      return { success: false, message: 'Failed to create announcement' };
    }
  }

  @Patch(':id')
  async updateAnnouncement(@Param('id') id: string, @Body() body: { title?: string; subtitle?: string; isImportant?: boolean }) {
    try {
      const announcement = await this.announcementService.update(id, body);
      return { success: true, data: announcement };
    } catch (error) {
      return { success: false, message: 'Failed to update announcement' };
    }
  }

  @Delete(':id')
  async deleteAnnouncement(@Param('id') id: string) {
    try {
      await this.announcementService.delete(id);
      return { success: true, message: 'Announcement deleted successfully' };
    } catch (error) {
      return { success: false, message: 'Failed to delete announcement' };
    }
  }
}
