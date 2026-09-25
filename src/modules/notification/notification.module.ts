import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { PrismaModule } from '../../prisma/prisma.module';

// ScheduleModule.forRoot() is registered once, in AppModule — registering it
// here too risked running the daily reminder twice.
@Module({
  imports: [PrismaModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
