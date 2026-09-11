import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HrModule } from './modules/hr/hr.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { ManagerModule } from './modules/manager/manager.module';
import { CeoModule } from './modules/ceo/ceo.module';
import { UploadModule } from './modules/upload/upload.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ExportModule } from './modules/export/export.module';
import { AnnouncementModule } from './modules/announcement/announcement.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // เปิดใช้งานการอ้างอิงตัวแปรกลางในไฟล์ .env เช่น ${API_BASE_URL}
      expandVariables: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    HrModule,
    EmployeeModule,
    ManagerModule,
    CeoModule,
    UploadModule,
    NotificationModule,
    ExportModule,
    AnnouncementModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}
