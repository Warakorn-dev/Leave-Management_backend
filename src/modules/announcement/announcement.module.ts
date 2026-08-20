import { Module } from '@nestjs/common';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnnouncementController],
  providers: [AnnouncementService]
})
export class AnnouncementModule {}
