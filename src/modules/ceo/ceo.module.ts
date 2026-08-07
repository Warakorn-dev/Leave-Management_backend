import { Module } from '@nestjs/common';
import { CeoService } from './ceo.service';
import { CeoController } from './ceo.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [CeoController],
  providers: [CeoService],
})
export class CeoModule {}
