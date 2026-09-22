import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { NotificationModule } from '../notification/notification.module';
import { HrOrgService } from './services/hr-org.service';
import { HrEmployeeService } from './services/hr-employee.service';
import { HrDashboardService } from './services/hr-dashboard.service';
import { HrLeaveVerificationService } from './services/hr-leave-verification.service';

@Module({
  imports: [NotificationModule],
  controllers: [HrController],
  providers: [
    HrOrgService,
    HrEmployeeService,
    HrDashboardService,
    HrLeaveVerificationService,
  ],
})
export class HrModule {}
