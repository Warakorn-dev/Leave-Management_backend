/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { NotificationService } from './notification.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const sendMail = jest.fn();
const config: Record<string, unknown> = {
  'email.host': 'smtp.test',
  'email.port': 587,
  'email.user': 'noreply@nid.test',
  'email.pass': 'x',
};

function createPrisma() {
  return {
    notification: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    leaveRequest: { findMany: jest.fn() },
    employee: { findMany: jest.fn() },
  };
}
let prisma: ReturnType<typeof createPrisma>;
let service: NotificationService;

beforeEach(() => {
  sendMail.mockReset().mockResolvedValue({ messageId: 'm-1' });
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  prisma = createPrisma();
  service = new NotificationService(
    { get: (k: string) => config[k] } as never,
    prisma as never,
  );
});

const flush = () => new Promise((r) => setImmediate(r));

describe('NotificationService.sendEmail', () => {
  it('builds the SMTP transport from config (no real server in tests)', () => {
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test',
      port: 587,
      secure: false,
      auth: { user: 'noreply@nid.test', pass: 'x' },
    });
  });

  it('sends recipient, subject and text; html falls back to the text', async () => {
    await expect(
      service.sendEmail('emp@nid.test', 'หัวข้อ', 'เนื้อหา'),
    ).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledWith({
      from: '"Leave Management System" <noreply@nid.test>',
      to: 'emp@nid.test',
      subject: 'หัวข้อ',
      text: 'เนื้อหา',
      html: 'เนื้อหา',
    });
  });

  it('an SMTP failure is logged and never breaks the caller (fire-and-forget)', async () => {
    sendMail.mockRejectedValue(new Error('SMTP down'));
    const log = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(service.sendEmail('a@nid.test', 's', 't')).resolves.toBe(true);
    await flush();
    expect(log).toHaveBeenCalledWith(
      'Error sending email to a@nid.test',
      expect.any(Error),
    );
  });
});

describe('NotificationService in-app notifications', () => {
  it('lists only the caller’s own 10 newest notifications', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { id: 'n-1', message: 'ปกติ' },
    ]);
    await service.getNotifications('u-1');
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('a user with no notifications gets an empty list; nothing is invented or written', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ role: { name: 'Employee' } });
    await expect(service.getNotifications('u-new')).resolves.toEqual([]);
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
    expect(prisma.notification.findMany).toHaveBeenCalledTimes(1);
  });

  it.each(['CEO', 'Manager', 'HR', 'Employee'])(
    'no sample notifications are created for a new %s either',
    async (role) => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({ role: { name: role } });
      await service.getNotifications('u-new');
      expect(prisma.notification.create).not.toHaveBeenCalled();
    },
  );

  it('stored messages are returned exactly as saved (no rewriting on read)', async () => {
    const stored = [
      { id: 'n-1', message: 'ลากิจ (0.25 วัน)' },
      { id: 'n-2', message: 'ส่งคำขอลาพักร้อน 3 วัน (10 - 12 ส.ค.)' },
    ];
    prisma.notification.findMany.mockResolvedValue(stored);
    await expect(service.getNotifications('u-1')).resolves.toEqual([
      { id: 'n-1', message: 'ลากิจ (0.25 วัน)' },
      { id: 'n-2', message: 'ส่งคำขอลาพักร้อน 3 วัน (10 - 12 ส.ค.)' },
    ]);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('IDOR: marking read is scoped to the caller, someone else’s id is "not found"', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markAsRead('n-of-B', 'u-A')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n-of-B', userId: 'u-A' },
      data: { isRead: true },
    });
  });

  it('marking one of your own as read succeeds', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.markAsRead('n-1', 'u-A')).resolves.toEqual({
      success: true,
    });
  });

  it('mark-all touches only the caller’s unread notifications', async () => {
    await service.markAllAsRead('u-A');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-A', isRead: false },
      data: { isRead: true },
    });
  });

  it('createNotification defaults the type to SYSTEM and the link to null', async () => {
    await service.createNotification({
      userId: 'u-1',
      title: 't',
      message: 'm',
    });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'u-1',
        title: 't',
        message: 'm',
        type: 'SYSTEM',
        redirectUrl: null,
      },
    });
  });
});

describe('Daily pending-leave reminder (business rule 2026-09-24)', () => {
  // ---- a small in-memory organisation ----------------------------------
  type U = { id: string; email: string; role: string; isActive: boolean };
  type E = {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    departmentId: string;
    position: string;
  };
  const users: U[] = [
    { id: 'u-hr', email: 'hr@nid.test', role: 'HR', isActive: true },
    { id: 'u-hr-off', email: 'hr-off@nid.test', role: 'HR', isActive: false },
    { id: 'u-hrlead', email: 'hrlead@nid.test', role: 'HR', isActive: true },
    { id: 'u-mgr', email: 'mgr@nid.test', role: 'Manager', isActive: true },
    { id: 'u-mgr2', email: 'mgr2@nid.test', role: 'Manager', isActive: true },
    { id: 'u-ceo', email: 'ceo@nid.test', role: 'CEO', isActive: true },
    { id: 'u-emp', email: 'emp@nid.test', role: 'Employee', isActive: true },
    { id: 'u-hr2', email: 'hr2@nid.test', role: 'HR', isActive: true },
  ];
  const employees: E[] = [
    {
      id: 'e-hr',
      userId: 'u-hr',
      firstName: 'ฮาน่า',
      lastName: 'HR',
      departmentId: 'dept-hr',
      position: 'HR Officer',
    },
    {
      id: 'e-hr-off',
      userId: 'u-hr-off',
      firstName: 'ปิด',
      lastName: 'ใช้งาน',
      departmentId: 'dept-hr',
      position: 'HR Officer',
    },
    {
      id: 'e-hrlead',
      userId: 'u-hrlead',
      firstName: 'รอฮายู',
      lastName: 'หัวหน้า',
      departmentId: 'dept-hr',
      position: 'Leader',
    },
    {
      id: 'e-mgr',
      userId: 'u-mgr',
      firstName: 'วิไล',
      lastName: 'ใจดี',
      departmentId: 'dept-dev',
      position: 'Manager',
    },
    {
      id: 'e-mgr2',
      userId: 'u-mgr2',
      firstName: 'วีระ',
      lastName: 'ขายเก่ง',
      departmentId: 'dept-sales',
      position: 'Manager',
    },
    {
      id: 'e-ceo',
      userId: 'u-ceo',
      firstName: 'ซีอีโอ',
      lastName: 'ใหญ่',
      departmentId: 'dept-exec',
      position: 'CEO',
    },
    {
      id: 'e-emp',
      userId: 'u-emp',
      firstName: 'สมหญิง',
      lastName: 'ใจงาม',
      departmentId: 'dept-dev',
      position: 'Programmer',
    },
    {
      id: 'e-hr2',
      userId: 'u-hr2',
      firstName: 'ฮารุ',
      lastName: 'HR',
      departmentId: 'dept-hr',
      position: 'HR Officer',
    },
  ];
  const NOW = new Date('2026-10-01T02:00:00Z'); // 09:00 Bangkok
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
  const leave = (id: string, empId: string, status: string, created: Date) => ({
    id,
    employeeId: empId,
    status,
    createdAt: created,
    startDate: new Date('2026-10-05T00:00:00Z'),
    endDate: new Date('2026-10-06T00:00:00Z'),
    leaveType: { name: 'ลาป่วย' },
    employee: employees.find((e) => e.id === empId)!,
  });
  let leaves: ReturnType<typeof leave>[];

  const userView = (u: U) => ({
    id: u.id,
    email: u.email,
    employee: employees.find((e) => e.userId === u.id) ?? null,
  });

  beforeEach(() => {
    leaves = [
      leave('L1', 'e-emp', 'PENDING_VERIFY', daysAgo(3)),
      leave('L2', 'e-emp', 'PENDING_SUPERVISOR', daysAgo(1)),
      leave('L3', 'e-mgr', 'PENDING_EXECUTIVE', NOW),
      leave('L4', 'e-emp', 'PENDING_CANCELLATION', daysAgo(2)),
      leave('L5', 'e-hr', 'PENDING_VERIFY', daysAgo(1)), // HR's own leave
      leave('L6', 'e-emp', 'APPROVED', daysAgo(9)), // finished: never reminded
      leave('L7', 'e-hr2', 'PENDING_SUPERVISOR', daysAgo(1)), // HR dept → HR Manager
    ];
    Object.assign(prisma, {
      leaveRequest: {
        findMany: jest.fn(
          ({ where }: { where: { status: { in: string[] } } }) =>
            Promise.resolve(
              leaves.filter((l) => where.status.in.includes(l.status)),
            ),
        ),
      },
    });
    Object.assign(prisma.user, {
      findMany: jest.fn(
        ({ where }: { where: { isActive: boolean; role: { name: string } } }) =>
          Promise.resolve(
            users
              .filter(
                (u) =>
                  u.isActive === where.isActive && u.role === where.role.name,
              )
              .map(userView),
          ),
      ),
    });
    Object.assign(prisma, {
      employee: {
        findMany: jest.fn(
          ({
            where,
          }: {
            where: {
              departmentId: { in: string[] };
              user: { isActive: boolean; role: { name: { in: string[] } } };
            };
          }) =>
            Promise.resolve(
              employees
                .filter((e) => where.departmentId.in.includes(e.departmentId))
                .map((e) => ({
                  ...e,
                  u: users.find((u) => u.id === e.userId)!,
                }))
                .filter(
                  (e) =>
                    e.u.isActive === where.user.isActive &&
                    where.user.role.name.in.includes(e.u.role),
                )
                .map(({ u, ...e }) => ({
                  ...e,
                  user: { email: u.email, role: { name: u.role } },
                  position: { name: e.position },
                })),
            ),
        ),
      },
    });
  });

  const mails = () =>
    (sendMail.mock.calls as unknown[][]).map(
      (c) => c[0] as { to: string; subject: string; text: string },
    );
  const mailTo = (to: string) => mails().find((m) => m.to === to);

  it('sends ONE e-mail per approver who has something waiting — and nobody else', async () => {
    const out = await service.sendPendingReminders(NOW);
    expect(
      mails()
        .map((m) => m.to)
        .sort(),
    ).toEqual([
      'ceo@nid.test',
      'hr2@nid.test',
      'hr@nid.test',
      'hrlead@nid.test',
      'mgr@nid.test',
    ]);
    expect(out).toEqual({ requests: 6, emails: 5 });
  });

  it('HR gets the requests waiting for HR review and the cancellation requests, not their own leave', async () => {
    await service.sendPendingReminders(NOW);
    const m = mailTo('hr@nid.test')!;
    expect(m.subject).toBe(
      '[Leave Request] มีคำขอลารอการพิจารณาของคุณ 2 รายการ',
    );
    expect(m.text).toContain('เรียน ฮาน่า');
    expect(m.text).toContain('คำขอลารอฝ่ายบุคคลตรวจสอบ (1 รายการ)');
    expect(m.text).toContain(
      '- สมหญิง ใจงาม: ลาป่วย 5 ต.ค. 2569 – 6 ต.ค. 2569 (ค้าง 3 วัน)',
    );
    expect(m.text).toContain('คำขอยกเลิกใบลารอตรวจสอบ (1 รายการ)');
    expect(m.text).not.toContain('ฮาน่า HR:'); // own leave L5
    expect(mailTo('hr2@nid.test')!.text).toContain('ฮาน่า HR: ลาป่วย'); // another HR sees it
  });

  it('a department head gets only their own department’s requests waiting for them', async () => {
    await service.sendPendingReminders(NOW);
    const m = mailTo('mgr@nid.test')!;
    expect(m.subject).toContain('1 รายการ');
    expect(m.text).toContain('คำขอลารอหัวหน้าแผนกอนุมัติ (1 รายการ)');
    expect(m.text).toContain('สมหญิง ใจงาม: ลาป่วย');
    expect(m.text).not.toContain('ฮารุ'); // other department (L7)
    expect(mailTo('mgr2@nid.test')).toBeUndefined();
  });

  it('an HR department head gets the HR department’s approvals in the same single e-mail as the HR review list', async () => {
    await service.sendPendingReminders(NOW);
    const m = mailTo('hrlead@nid.test')!;
    expect(m.text).toContain('คำขอลารอหัวหน้าแผนกอนุมัติ (1 รายการ)');
    expect(m.text).toContain('ฮารุ HR: ลาป่วย');
    expect(m.text).toContain('คำขอลารอฝ่ายบุคคลตรวจสอบ');
    expect(mails().filter((x) => x.to === 'hrlead@nid.test')).toHaveLength(1);
  });

  it('the CEO gets the managers’ requests waiting for executive approval', async () => {
    await service.sendPendingReminders(NOW);
    const m = mailTo('ceo@nid.test')!;
    expect(m.text).toContain('คำขอลารอผู้บริหาร (CEO) อนุมัติ (1 รายการ)');
    expect(m.text).toContain(
      '- วิไล ใจดี: ลาป่วย 5 ต.ค. 2569 – 6 ต.ค. 2569 (ยื่นวันนี้)',
    );
  });

  it('suspended accounts are never reminded; finished requests never appear', async () => {
    await service.sendPendingReminders(NOW);
    expect(mailTo('hr-off@nid.test')).toBeUndefined();
    expect(mails().some((m) => m.text.includes('ค้าง 9 วัน'))).toBe(false); // L6
  });

  it('nothing pending → no e-mail and no user lookups', async () => {
    leaves = [];
    await expect(service.sendPendingReminders(NOW)).resolves.toEqual({
      requests: 0,
      emails: 0,
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('an SMTP failure for one person does not stop the others', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    const out = await service.sendPendingReminders(NOW);
    expect(out.emails).toBe(5);
    expect(sendMail).toHaveBeenCalledTimes(5);
  });

  it('the scheduled run never throws: a database error is logged and no e-mail goes out', async () => {
    prisma.leaveRequest.findMany.mockRejectedValue(new Error('db down'));
    const err = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(service.handleCron()).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      'Pending-leave reminder run failed',
      expect.any(Error),
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('the scheduled run sends the reminders and logs a summary', async () => {
    const log = jest
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined);
    await service.handleCron();
    expect(sendMail).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Pending-leave reminders:'),
    );
  });

  it('is scheduled every day at 09:00 Bangkok time', () => {
    const opts = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      Object.getOwnPropertyDescriptor(
        NotificationService.prototype,
        'handleCron',
      )!.value as object,
    ) as { cronTime: string; timeZone: string };
    expect(opts).toEqual(
      expect.objectContaining({
        cronTime: '0 09 * * *',
        timeZone: 'Asia/Bangkok',
      }),
    );
  });
});
