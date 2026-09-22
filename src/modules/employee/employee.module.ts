import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { NotificationModule } from '../notification/notification.module';
import { EmployeeMutationService } from './services/employee-mutation.service';
import { EmployeeQueryService } from './services/employee-query.service';

@Module({
  imports: [NotificationModule],
  controllers: [EmployeeController],
  providers: [EmployeeMutationService, EmployeeQueryService],
})
export class EmployeeModule {}
