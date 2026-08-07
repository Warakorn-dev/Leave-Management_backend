import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('email.host'),
      port: this.configService.get<number>('email.port'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: this.configService.get<string>('email.user'),
        pass: this.configService.get<string>('email.pass'),
      },
    });
  }

  async sendEmail(to: string, subject: string, text: string, html?: string) {
    try {
      const info = await this.transporter.sendMail({
        from: `"Leave Management System" <${this.configService.get<string>('email.user')}>`,
        to,
        subject,
        text,
        html: html || text,
      });
      this.logger.log(`Message sent: ${info.messageId}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending email to ${to}`, error);
      return false;
    }
  }

  // Cron Job to send reminder for pending requests
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  handleCron() {
    this.logger.debug('Running daily cron job for pending leave request reminders');
    // Logic to query pending requests and send emails to managers
    // For now, it just logs
  }

  async getNotifications(userId: string) {
    let list = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Auto fix any existing old notification text in DB
    for (const item of list) {
      let needsUpdate = false;
      let newMsg = item.message;

      if (newMsg.includes('(0.25 วัน)')) {
        newMsg = newMsg.replace('(0.25 วัน)', '(2 ชั่วโมง) วันที่ 10 ส.ค. 2026 เวลา 09:00 - 11:00 น.');
        needsUpdate = true;
      }
      if (newMsg.includes('ส่งคำขอลาพักร้อน 3 วัน (10 - 12 ส.ค.)')) {
        newMsg = newMsg.replace('ส่งคำขอลาพักร้อน 3 วัน (10 - 12 ส.ค.)', 'ได้ยื่นคำขอ ลาพักร้อน (3 วัน) วันที่ 10 - 12 ส.ค. 2026');
        needsUpdate = true;
      }

      if (needsUpdate) {
        await this.prisma.notification.update({
          where: { id: item.id },
          data: { message: newMsg }
        });
        item.message = newMsg;
      }
    }

    if (list.length === 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });

      const roleName = user?.role?.name?.toLowerCase() || 'user';
      let sampleNotifications: any[] = [];

      if (roleName === 'ceo') {
        sampleNotifications = [
          {
            userId,
            title: 'มีคำขอลาจากผู้จัดการแผนก',
            message: 'ผู้จัดการแผนก "วิไล ใจดี" ได้ยื่นคำขอ ลากิจธุระอันจำเป็น (3 ชั่วโมง) วันที่ 10 ส.ค. 2026 เวลา 09:00 - 12:00 น.',
            type: 'NEW_ORDER',
            redirectUrl: '/dashboard/ceo/approval',
            isRead: false,
            createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 นาทีที่แล้ว
          },
          {
            userId,
            title: 'ประกาศใหม่จาก HR',
            message: 'รายงานสรุปสถิติการลางานและโควต้าคงเหลือพนักงานประจำไตรมาสที่ 3',
            type: 'SYSTEM',
            redirectUrl: '/dashboard/ceo/dashboard',
            isRead: false,
            createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 ชั่วโมงที่แล้ว
          },
        ];
      } else if (roleName === 'manager') {
        sampleNotifications = [
          {
            userId,
            title: 'มีคำขอลาใหม่ในแผนก',
            message: 'พนักงาน "สมชาย พากเพียร" ได้ส่งคำขอลาป่วย 2 วัน (5 - 6 ส.ค.)',
            type: 'NEW_ORDER',
            redirectUrl: '/dashboard/manager/approve',
            isRead: false,
            createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 นาทีที่แล้ว
          },
          {
            userId,
            title: 'คำขอลาได้รับการอนุมัติจาก CEO',
            message: 'คำขอลาพักร้อนล่วงหน้าของคุณได้รับการอนุมัติจาก CEO เรียบร้อยแล้ว',
            type: 'APPROVE',
            redirectUrl: '/dashboard/manager/history',
            isRead: false,
            createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 ชั่วโมงที่แล้ว
          },
          {
            userId,
            title: 'ประกาศใหม่จาก HR',
            message: 'ประกาศแจ้งกำหนดการประเมินผลการทำงานพนักงานประจำปี 2026',
            type: 'SYSTEM',
            redirectUrl: '/dashboard/manager',
            isRead: true,
            createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // เมื่อวาน
          },
        ];
      } else if (roleName === 'hr') {
        sampleNotifications = [
          {
            userId,
            title: 'คำขอลาได้รับการอนุมัติจาก CEO',
            message: 'คำขอลาพักร้อนของคุณได้รับการอนุมัติโดย CEO เรียบร้อยแล้ว',
            type: 'APPROVE',
            redirectUrl: '/dashboard/hr/leave-history',
            isRead: false,
            createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 นาทีที่แล้ว
          },
          {
            userId,
            title: 'ประกาศใหม่จาก HR',
            message: 'การปรับปรุงเกณฑ์และแบบฟอร์มการสวัสดิการพนักงานใหม่ประจำปี',
            type: 'SYSTEM',
            redirectUrl: '/dashboard/hr/dashboard',
            isRead: false,
            createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 ชั่วโมงที่แล้ว
          },
        ];
      } else {
        // User (Employee)
        sampleNotifications = [
          {
            userId,
            title: 'คำขอลาได้รับการอนุมัติจาก Manager',
            message: 'คำขอลาพักร้อนประจำปีของคุณได้รับการอนุมัติจากผู้จัดการแผนกเรียบร้อยแล้ว',
            type: 'APPROVE',
            redirectUrl: '/dashboard/user/history',
            isRead: false,
            createdAt: new Date(Date.now() - 12 * 60 * 1000), // 12 นาทีที่แล้ว
          },
          {
            userId,
            title: 'ประกาศใหม่จาก HR',
            message: 'ประกาศวันหยุดชดเชยเทศกาลและแนวทางการยื่นคำขอลาพักผ่อนประจำปี',
            type: 'SYSTEM',
            redirectUrl: '/dashboard/user/calendar',
            isRead: false,
            createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 ชั่วโมงที่แล้ว
          },
        ];
      }

      for (const item of sampleNotifications) {
        await this.prisma.notification.create({ data: item });
      }

      list = await this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    }

    return list;
  }

  async createNotification(data: { userId: string; title: string; message: string; type?: string; redirectUrl?: string }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type || 'SYSTEM',
        redirectUrl: data.redirectUrl || null,
      }
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
