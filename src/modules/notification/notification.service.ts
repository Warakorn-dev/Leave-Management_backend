import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { isDepartmentApprover } from './leave-history-url';

/** Status → heading in the daily reminder e-mail. */
const REMINDER_SECTIONS: Record<string, string> = {
  PENDING_VERIFY: 'คำขอลารอฝ่ายบุคคลตรวจสอบ',
  REVIEWING_HR: 'คำขอลารอฝ่ายบุคคลตรวจสอบ',
  PENDING_CANCELLATION: 'คำขอยกเลิกใบลารอตรวจสอบ',
  PENDING_SUPERVISOR: 'คำขอลารอหัวหน้าแผนกอนุมัติ',
  PENDING_EXECUTIVE: 'คำขอลารอผู้บริหาร (CEO) อนุมัติ',
};

function thaiDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

/** "- สมหญิง ใจดี: ลาป่วย 5 ต.ค. 2569 – 6 ต.ค. 2569 (ค้าง 2 วัน)" */
function reminderLine(
  req: {
    startDate: Date;
    endDate: Date;
    createdAt: Date;
    leaveType: { name: string };
    employee: { firstName: string; lastName: string };
  },
  now: Date,
): string {
  const days = Math.max(
    0,
    Math.floor((now.getTime() - req.createdAt.getTime()) / 86_400_000),
  );
  const range =
    thaiDate(req.startDate) === thaiDate(req.endDate)
      ? thaiDate(req.startDate)
      : `${thaiDate(req.startDate)} – ${thaiDate(req.endDate)}`;
  const age = days === 0 ? 'ยื่นวันนี้' : `ค้าง ${days} วัน`;
  return `- ${req.employee.firstName} ${req.employee.lastName}: ${req.leaveType.name} ${range} (${age})`;
}

@Injectable()
export class NotificationService {
  private transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo>;
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

  // eslint-disable-next-line @typescript-eslint/require-await -- intentionally fire-and-forget, kept async so callers may `await` it without breaking
  async sendEmail(to: string, subject: string, text: string, html?: string) {
    // ทำงานแบบ Fire-and-forget เพื่อไม่ให้ API ค้างเวลารอส่งอีเมล
    this.transporter
      .sendMail({
        from: `"Leave Management System" <${this.configService.get<string>('email.user')}>`,
        to,
        subject,
        text,
        html: html || text,
      })
      .then((info) => this.logger.log(`Message sent: ${info.messageId}`))
      .catch((error) =>
        this.logger.error(`Error sending email to ${to}`, error),
      );

    return true;
  }

  // Daily 09:00 (Bangkok) reminder: one e-mail per approver who has leave
  // requests waiting for them (business rule 2026-09-24).
  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Bangkok' })
  async handleCron() {
    try {
      const summary = await this.sendPendingReminders();
      this.logger.log(
        `Pending-leave reminders: ${summary.emails} e-mail(s) for ${summary.requests} request(s)`,
      );
    } catch (e) {
      // Never let a failed run crash the scheduler; the next run retries.
      this.logger.error('Pending-leave reminder run failed', e);
    }
  }

  /**
   * Collects every request still waiting for someone and sends each approver
   * one summary e-mail:
   * - HR: waiting for HR review, and cancellation requests
   * - department head (role Manager, or HR whose position is a leader/manager):
   *   their department's requests waiting for department approval
   * - CEO: requests waiting for executive approval
   * Only active accounts are reminded, and nobody is reminded about their own
   * request (they cannot decide it).
   */
  async sendPendingReminders(now: Date = new Date()) {
    const pending = await this.prisma.leaveRequest.findMany({
      where: { status: { in: Object.keys(REMINDER_SECTIONS) } },
      orderBy: { createdAt: 'asc' },
      include: { leaveType: true, employee: true },
    });
    if (pending.length === 0) return { requests: 0, emails: 0 };

    const [hrUsers, ceoUsers] = await Promise.all(
      ['HR', 'CEO'].map((role) =>
        this.prisma.user.findMany({
          where: { isActive: true, role: { name: role } },
          include: { employee: true },
        }),
      ),
    );

    const deptIds = [
      ...new Set(
        pending
          .filter((r) => r.status === 'PENDING_SUPERVISOR')
          .map((r) => r.employee.departmentId)
          .filter((d): d is string => !!d),
      ),
    ];
    const deptHeads = deptIds.length
      ? (
          await this.prisma.employee.findMany({
            where: {
              departmentId: { in: deptIds },
              user: {
                isActive: true,
                role: { name: { in: ['Manager', 'HR'] } },
              },
            },
            include: { user: { include: { role: true } }, position: true },
          })
        ).filter((e) =>
          isDepartmentApprover(e.user?.role?.name, e.position?.name),
        )
      : [];

    type Recipient = {
      email: string;
      name: string;
      sections: Map<string, string[]>;
    };
    const recipients = new Map<string, Recipient>();
    const add = (
      userId: string,
      email: string | null | undefined,
      name: string,
      section: string,
      line: string,
    ) => {
      if (!email) return;
      const r = recipients.get(userId) ?? {
        email,
        name,
        sections: new Map<string, string[]>(),
      };
      r.sections.set(section, [...(r.sections.get(section) ?? []), line]);
      recipients.set(userId, r);
    };

    for (const req of pending) {
      const section = REMINDER_SECTIONS[req.status];
      const line = reminderLine(req, now);
      const approvers =
        req.status === 'PENDING_SUPERVISOR'
          ? deptHeads
              .filter((h) => h.departmentId === req.employee.departmentId)
              .map((h) => ({
                userId: h.userId,
                email: h.user?.email,
                name: h.firstName,
                employeeId: h.id,
              }))
          : (req.status === 'PENDING_EXECUTIVE' ? ceoUsers : hrUsers).map(
              (u) => ({
                userId: u.id,
                email: u.email,
                name: u.employee?.firstName ?? u.email,
                employeeId: u.employee?.id,
              }),
            );
      for (const a of approvers) {
        if (a.employeeId === req.employeeId) continue; // own request
        add(a.userId, a.email, a.name, section, line);
      }
    }

    for (const r of recipients.values()) {
      const count = [...r.sections.values()].reduce((n, l) => n + l.length, 0);
      const body = [...r.sections.entries()]
        .map(
          ([title, lines]) =>
            `${title} (${lines.length} รายการ)\n${lines.join('\n')}`,
        )
        .join('\n\n');
      await this.sendEmail(
        r.email,
        `[Leave Request] มีคำขอลารอการพิจารณาของคุณ ${count} รายการ`,
        `เรียน ${r.name},\n\nรายการที่รอการพิจารณาของคุณ ณ วันนี้:\n\n${body}\n\nกรุณาเข้าสู่ระบบเพื่อดำเนินการ`,
      );
    }
    return { requests: pending.length, emails: recipients.size };
  }

  // Returns only real notifications. (Until 2026-09-24 this inserted sample
  // notifications for users with none and rewrote some stored messages.)
  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  async createNotification(data: {
    userId: string;
    title: string;
    message: string;
    type?: string;
    redirectUrl?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type || 'SYSTEM',
        redirectUrl: data.redirectUrl || null,
      },
    });
  }

  async markAsRead(id: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });

    if (result.count === 0) {
      throw new NotFoundException('Notification not found or access denied');
    }

    return { success: true };
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
