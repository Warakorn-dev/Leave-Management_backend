/// <reference types="jest" />
/**
 * Business-flow tests for the leave workflow.
 *
 * The real services are chained end to end (EmployeeMutationService →
 * HrLeaveVerificationService → ManagerService → CeoService) on top of an
 * in-memory Prisma fake, so each test checks persisted state (status,
 * approvals, balances, notifications, e-mails) and not only return values.
 *
 * Tests whose name starts with "[FLOW]" assert business-flow requirements that
 * the implementation originally violated (fixed 2026-09-24 in production code).
 * They now guard against regressions — never edit them to match code again.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { EmployeeMutationService } from './employee/services/employee-mutation.service';
import { HrLeaveVerificationService } from './hr/services/hr-leave-verification.service';
import { ManagerService } from './manager/manager.service';
import { CeoService } from './ceo/ceo.service';
import { CreateLeaveRequestDto } from './employee/dto/employee.dto';
import {
  LT,
  U,
  TODAY,
  createFakePrisma,
  createNotificationMock,
  balanceOf,
  leaveOf,
  approvalsOf,
  notificationsFor,
  emailsTo,
  FakePrisma,
  SeedLeaveType,
} from '../test-utils/leave-flow.fixtures';

// Mon 5 Oct – Tue 6 Oct 2026 (2 working days), comfortably in the future of TODAY.
const START = '2026-10-05';
const END = '2026-10-06';
const HR_USERS = [U.hr, U.hr2, U.hrLeader];

let prisma: FakePrisma;
let mail: ReturnType<typeof createNotificationMock>;
let employee: EmployeeMutationService;
let hr: HrLeaveVerificationService;
let manager: ManagerService;
let ceo: CeoService;

function build(opts: Parameters<typeof createFakePrisma>[0] = {}) {
  prisma = createFakePrisma(opts);
  mail = createNotificationMock();
  employee = new EmployeeMutationService(prisma as never, mail as never);
  hr = new HrLeaveVerificationService(prisma as never, mail as never);
  manager = new ManagerService(prisma as never, mail as never);
  ceo = new CeoService(prisma as never, mail as never);
}

const submit = (
  userId: string,
  lt: SeedLeaveType,
  extra: Partial<CreateLeaveRequestDto> = {},
) =>
  employee.createLeaveRequest(userId, {
    leaveTypeId: lt.id,
    leaveMode: 'full_day',
    startDate: START,
    endDate: END,
    reason: 'ทดสอบระบบ',
    ...extra,
  });

const hrApprove = (id: string, by: string = U.hr) =>
  hr.processLeaveRequest(by, id, 'Approve', {});
const hrReject = (id: string, reason?: string, by: string = U.hr) =>
  hr.processLeaveRequest(by, id, 'Reject', { comment: reason });
const mgrApprove = (id: string, by: string = U.mgr) =>
  manager.processRequest(by, id, 'Approve', {});
const mgrReject = (id: string, reason?: string, by: string = U.mgr) =>
  manager.processRequest(by, id, 'Reject', { comment: reason });
const ceoApprove = (id: string, by: string = U.ceo) =>
  ceo.approveSpecialLeave(by, id, 'Approve');
const ceoReject = (id: string, reason?: string, by: string = U.ceo) =>
  ceo.approveSpecialLeave(by, id, 'Reject', reason);

/**
 * The CEO cannot submit leave (business rule), so tests that guard the
 * defensive "no CEO self-approval" rule seed a CEO request straight into the
 * fake, in the same shape createLeaveRequest would have stored it.
 */
function seedCeoLeave(lt: SeedLeaveType = LT.sick): { id: string } {
  const id = `leave-ceo-seed-${prisma.state.leaveRequests.length + 1}`;
  prisma.state.leaveRequests.push({
    id,
    requestCode: null,
    employeeId: 'emp-ceo',
    leaveTypeId: lt.id,
    startDate: new Date(START),
    endDate: new Date(END),
    startFormat: 'full',
    endFormat: 'full',
    totalDays: 2,
    paidDays: 2,
    unpaidDays: 0,
    reason: 'ทดสอบระบบ',
    status: 'PENDING_VERIFY',
    isViewedByHr: false,
    currentHrReviewerId: null,
    hrReviewStartedAt: null,
    createdAt: new Date(),
    days: [
      { date: new Date(START), portion: 'full' },
      { date: new Date(END), portion: 'full' },
    ],
  });
  return { id };
}

/** Runs a request all the way to APPROVED along whatever path the code routes it. */
async function approveFully(id: string) {
  await hrApprove(id);
  if (leaveOf(prisma, id).status === 'PENDING_SUPERVISOR') await mgrApprove(id);
  if (leaveOf(prisma, id).status === 'PENDING_EXECUTIVE') await ceoApprove(id);
  expect(leaveOf(prisma, id).status).toBe('APPROVED');
}

beforeAll(() => {
  jest.useFakeTimers({
    now: TODAY,
    doNotFake: [
      'nextTick',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'hrtime',
      'performance',
    ],
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
beforeEach(() => build());

// =============================================================================
describe('FLOW 1 — Employee sick leave (approved)', () => {
  it('creates the request as PENDING_VERIFY with the computed days, code and per-day rows', async () => {
    const created = await submit(U.emp, LT.sick);

    expect(created.status).toBe('PENDING_VERIFY');
    expect(prisma.leaveRequest.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest asymmetric matcher
      data: expect.objectContaining({
        employeeId: 'emp-1',
        leaveTypeId: LT.sick.id,
        startFormat: 'full',
        endFormat: 'full',
        totalDays: 2,
        paidDays: 2,
        unpaidDays: 0,
        reason: 'ทดสอบระบบ',
        status: 'PENDING_VERIFY',
      }),
    });
    const row = leaveOf(prisma, created.id);
    expect(row.requestCode).toMatch(/^L-01-00001-2569$/);
    expect(row.days.map((d) => d.portion)).toEqual(['full', 'full']);
  });

  it('does not deduct the balance at submission', async () => {
    await submit(U.emp, LT.sick);
    expect(balanceOf(prisma, 'emp-1', LT.sick.id)!.remainingDays).toBe(30);
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('notifies every HR reviewer (in-app + e-mail) and nobody else after submission', async () => {
    await submit(U.emp, LT.sick);

    for (const hrId of HR_USERS) {
      expect(notificationsFor(prisma, hrId)).toEqual([
        expect.objectContaining({
          type: 'NEW_ORDER',
          redirectUrl: '/dashboard/hr/approval',
          title: 'มีคำขอลาใหม่รอตรวจสอบ',
        }),
      ]);
    }
    expect(notificationsFor(prisma, U.mgr)).toHaveLength(0);
    expect(notificationsFor(prisma, U.ceo)).toHaveLength(0);
    expect(mail.sendEmail).toHaveBeenCalledTimes(3);
    expect(emailsTo(mail, 'hr@nid.test')[0][1]).toContain('ได้ยื่นคำขอลางาน');
    expect(emailsTo(mail, 'hr@nid.test')[0][2]).toContain('ลาป่วย');
  });

  it('HR reviewer approval moves it to PENDING_SUPERVISOR, logs the approval and clears the review lock', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);

    const row = leaveOf(prisma, id);
    expect(row.status).toBe('PENDING_SUPERVISOR');
    expect(row.currentHrReviewerId).toBeNull();
    expect(approvalsOf(prisma, id)).toEqual([
      expect.objectContaining({
        approverId: U.hr,
        status: 'PENDING_SUPERVISOR',
      }),
    ]);
  });

  it('after HR approval the department manager (only) and the employee are notified', async () => {
    const { id } = await submit(U.emp, LT.sick);
    prisma.state.notifications.length = 0;
    mail.sendEmail.mockClear();

    await hrApprove(id);

    expect(notificationsFor(prisma, U.mgr)).toEqual([
      expect.objectContaining({
        type: 'NEW_ORDER',
        redirectUrl: '/dashboard/manager/approve',
      }),
    ]);
    expect(notificationsFor(prisma, U.mgrOtherDept)).toHaveLength(0);
    expect(notificationsFor(prisma, U.emp)).toEqual([
      expect.objectContaining({
        title: 'คำขอลาผ่านการตรวจสอบเบื้องต้น',
        type: 'SYSTEM',
      }),
    ]);
    expect(emailsTo(mail, 'mgr@nid.test')).toHaveLength(1);
    expect(emailsTo(mail, 'emp@nid.test')).toHaveLength(1);
  });

  it('manager final approval sets APPROVED, logs it and deducts the balance', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);
    await mgrApprove(id);

    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(
      approvalsOf(prisma, id).map((a) => [a.approverId, a.status]),
    ).toEqual([
      [U.hr, 'PENDING_SUPERVISOR'],
      [U.mgr, 'APPROVED'],
    ]);
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: balanceOf(prisma, 'emp-1', LT.sick.id)!.id },
      data: { usedDays: 2, remainingDays: 28 },
    });
  });

  it('after final approval the employee and HR are notified; CEO is not involved', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);
    prisma.state.notifications.length = 0;
    await mgrApprove(id);

    expect(notificationsFor(prisma, U.emp)).toEqual([
      expect.objectContaining({
        type: 'APPROVE',
        title: 'คำขอลาได้รับการอนุมัติโดยหัวหน้าแผนก',
      }),
    ]);
    for (const hrId of HR_USERS) {
      expect(notificationsFor(prisma, hrId)).toEqual([
        expect.objectContaining({ title: 'คำขอลาพนักงานได้รับการอนุมัติ' }),
      ]);
    }
    expect(notificationsFor(prisma, U.ceo)).toHaveLength(0);
  });
});

// =============================================================================
describe('FLOW 2 — Employee personal-business leave (ลากิจ)', () => {
  it('follows the same HR → manager → APPROVED path as sick leave (not special)', async () => {
    const { id } = await submit(U.emp, LT.business);
    expect(leaveOf(prisma, id).status).toBe('PENDING_VERIFY');

    await hrApprove(id);
    expect(leaveOf(prisma, id).status).toBe('PENDING_SUPERVISOR');

    await mgrApprove(id);
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(balanceOf(prisma, 'emp-1', LT.business.id)!.remainingDays).toBe(1);
    expect(notificationsFor(prisma, U.ceo)).toHaveLength(0);
  });

  it('is limited by its own small balance (3 days): a 4-day request is refused at submission', async () => {
    await expect(
      submit(U.emp, LT.business, { endDate: '2026-10-08' }),
    ).rejects.toThrow(
      new BadRequestException('สิทธิ์วันลาไม่เพียงพอ (เหลือเพียง 3 วัน)'),
    );
    expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
  });

  it('pending requests reserve balance: a second request that would exceed it is refused', async () => {
    await submit(U.emp, LT.business); // 2 of 3 days pending
    await expect(
      submit(U.emp, LT.business, {
        startDate: '2026-10-07',
        endDate: '2026-10-08',
      }),
    ).rejects.toThrow('สิทธิ์วันลาไม่เพียงพอ (เหลือเพียง 1 วัน)');
  });
});

// =============================================================================
describe('FLOW 3 — Employee other / annual leave (special type)', () => {
  it('APPROVE path: HR → manager forwards to CEO → CEO approves; balance deducted only at the end', async () => {
    const { id } = await submit(U.emp, LT.vacation);
    await hrApprove(id);
    await mgrApprove(id);

    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');
    expect(balanceOf(prisma, 'emp-1', LT.vacation.id)!.remainingDays).toBe(6);
    expect(notificationsFor(prisma, U.ceo)).toEqual([
      expect.objectContaining({
        type: 'NEW_ORDER',
        redirectUrl: '/dashboard/ceo/approval',
      }),
    ]);

    await ceoApprove(id);
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(balanceOf(prisma, 'emp-1', LT.vacation.id)!.remainingDays).toBe(4);
    expect(approvalsOf(prisma, id).map((a) => a.status)).toEqual([
      'PENDING_SUPERVISOR',
      'PENDING_EXECUTIVE',
      'APPROVED',
    ]);
  });

  it('REJECT at review: reason saved, status REJECTED, employee told the reason, balance untouched', async () => {
    const { id } = await submit(U.emp, LT.vacation);
    await hrReject(id, 'เอกสารไม่ครบ');

    expect(leaveOf(prisma, id).status).toBe('REJECTED');
    expect(approvalsOf(prisma, id)).toEqual([
      expect.objectContaining({
        approverId: U.hr,
        status: 'REJECTED',
        comment: 'เอกสารไม่ครบ',
      }),
    ]);
    expect(notificationsFor(prisma, U.emp)).toEqual([
      expect.objectContaining({
        title: 'คำขอลาถูกปฏิเสธโดยฝ่ายบุคคล',
        message: 'เหตุผล: เอกสารไม่ครบ',
      }),
    ]);
    expect(emailsTo(mail, 'emp@nid.test')[0][2]).toContain('เอกสารไม่ครบ');
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    expect(notificationsFor(prisma, U.mgr)).toHaveLength(0);
  });

  it('after a rejection the employee can re-enter the process with a new request for the same dates', async () => {
    const { id } = await submit(U.emp, LT.vacation);
    await hrReject(id, 'เอกสารไม่ครบ');

    const again = await submit(U.emp, LT.vacation);
    expect(again.id).not.toBe(id);
    expect(again.status).toBe('PENDING_VERIFY');
  });

  it('a rejected request itself cannot be edited back into the process', async () => {
    const { id } = await submit(U.emp, LT.vacation);
    await hrReject(id, 'เอกสารไม่ครบ');
    await expect(
      employee.updateLeaveRequest(U.emp, id, { reason: 'แก้ไข' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[FLOW] the CEO forwarding e-mail names the actual leave type (not always "ลาพักผ่อน")', async () => {
    const { id } = await submit(U.emp, LT.ordination);
    await hrApprove(id);
    mail.sendEmail.mockClear();
    await mgrApprove(id);

    const [, subject, body] = emailsTo(mail, 'ceo@nid.test')[0];
    expect(`${subject}\n${body}`).toContain('ลาอุปสมบท');
    expect(`${subject}\n${body}`).not.toContain('ลาพักผ่อน');
  });
});

// =============================================================================
describe('FLOW 4 — Rejection at every stage', () => {
  it.each([
    ['HR reviewer', async (id: string) => hrReject(id)],
    [
      'manager',
      async (id: string) => {
        await hrApprove(id);
        return mgrReject(id);
      },
    ],
    [
      'CEO',
      async (id: string) => {
        await hrApprove(id);
        await mgrApprove(id);
        return ceoReject(id);
      },
    ],
  ])('%s cannot reject without a reason', async (_who, rejectWithoutReason) => {
    const { id } = await submit(U.emp, LT.vacation);
    await expect(rejectWithoutReason(id)).rejects.toThrow(
      'A rejection reason is required',
    );
  });

  it('manager reject: REJECTED, reason logged, balance untouched, employee + HR notified', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);
    prisma.state.notifications.length = 0;
    await mgrReject(id, 'ช่วงนี้งานเร่ง');

    expect(leaveOf(prisma, id).status).toBe('REJECTED');
    expect(approvalsOf(prisma, id)[1]).toEqual(
      expect.objectContaining({
        approverId: U.mgr,
        status: 'REJECTED',
        comment: 'ช่วงนี้งานเร่ง',
      }),
    );
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    expect(notificationsFor(prisma, U.emp)).toEqual([
      expect.objectContaining({
        type: 'REJECT',
        title: 'คำขอลาถูกปฏิเสธโดยหัวหน้าแผนก',
      }),
    ]);
    expect(notificationsFor(prisma, U.hr)).toHaveLength(1);
    expect(emailsTo(mail, 'emp@nid.test').at(-1)![2]).toContain(
      'ช่วงนี้งานเร่ง',
    );
  });

  it('[FLOW] manager reject: the in-app notification tells the employee the reason', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);
    prisma.state.notifications.length = 0;
    await mgrReject(id, 'ช่วงนี้งานเร่ง');

    expect(notificationsFor(prisma, U.emp)[0].message).toContain(
      'ช่วงนี้งานเร่ง',
    );
  });

  it('CEO reject: REJECTED, reason logged, balance untouched, employee + HR notified', async () => {
    const { id } = await submit(U.emp, LT.vacation);
    await hrApprove(id);
    await mgrApprove(id);
    prisma.state.notifications.length = 0;
    await ceoReject(id, 'ไม่อนุมัติช่วงปิดงบ');

    expect(leaveOf(prisma, id).status).toBe('REJECTED');
    expect(approvalsOf(prisma, id).at(-1)).toEqual(
      expect.objectContaining({
        approverId: U.ceo,
        status: 'REJECTED',
        comment: 'ไม่อนุมัติช่วงปิดงบ',
      }),
    );
    expect(balanceOf(prisma, 'emp-1', LT.vacation.id)!.remainingDays).toBe(6);
    expect(notificationsFor(prisma, U.emp)).toEqual([
      expect.objectContaining({ type: 'REJECT' }),
    ]);
    expect(notificationsFor(prisma, U.hr)).toHaveLength(1);
  });

  it('[FLOW] CEO reject: the in-app notification tells the employee the reason', async () => {
    const { id } = await submit(U.emp, LT.vacation);
    await hrApprove(id);
    await mgrApprove(id);
    prisma.state.notifications.length = 0;
    await ceoReject(id, 'ไม่อนุมัติช่วงปิดงบ');

    expect(notificationsFor(prisma, U.emp)[0].message).toContain(
      'ไม่อนุมัติช่วงปิดงบ',
    );
  });

  it('a rejected request cannot be rejected or approved again at any stage', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrReject(id, 'x');
    await expect(hrReject(id, 'y')).rejects.toThrow(
      'Invalid request or already verified',
    );
    await expect(hrApprove(id)).rejects.toThrow(
      'Invalid request or already verified',
    );
    await expect(mgrApprove(id)).rejects.toThrow(
      'Invalid request or already processed',
    );
    await expect(ceoApprove(id)).rejects.toThrow(
      'Request is not waiting for CEO approval',
    );
  });
});

// =============================================================================
describe('FLOW 5 — Employee cancels an approved leave', () => {
  async function approvedLeave(
    userId: string = U.emp,
    lt: SeedLeaveType = LT.sick,
  ) {
    const { id } = await submit(userId, lt);
    await approveFully(id);
    prisma.state.notifications.length = 0;
    mail.sendEmail.mockClear();
    return id;
  }

  it('submitting the cancellation moves it to PENDING_CANCELLATION and notifies every HR reviewer', async () => {
    const id = await approvedLeave();
    await employee.deleteLeaveRequest(U.emp, id);

    expect(leaveOf(prisma, id).status).toBe('PENDING_CANCELLATION');
    expect(prisma.leaveRequest.update).toHaveBeenLastCalledWith({
      where: { id },
      data: { status: 'PENDING_CANCELLATION' },
    });
    for (const hrId of HR_USERS) {
      expect(notificationsFor(prisma, hrId)).toEqual([
        expect.objectContaining({
          title: 'มีคำขอยกเลิกใบลารอตรวจสอบ',
          type: 'NEW_ORDER',
        }),
      ]);
    }
    expect(mail.sendEmail).toHaveBeenCalledTimes(3);
    expect(balanceOf(prisma, 'emp-1', LT.sick.id)!.remainingDays).toBe(28);
  });

  it('HR approves the cancellation: CANCELLED, approval logged, balance refunded, employee notified', async () => {
    const id = await approvedLeave();
    await employee.deleteLeaveRequest(U.emp, id);
    await hrApprove(id);

    expect(leaveOf(prisma, id).status).toBe('CANCELLED');
    expect(approvalsOf(prisma, id).at(-1)).toEqual(
      expect.objectContaining({ approverId: U.hr, status: 'CANCELLED' }),
    );
    expect(balanceOf(prisma, 'emp-1', LT.sick.id)).toEqual(
      expect.objectContaining({ remainingDays: 30, usedDays: 0 }),
    );
    expect(notificationsFor(prisma, U.emp).at(-1)).toEqual(
      expect.objectContaining({
        type: 'APPROVE',
        title: 'คำขอยกเลิกใบลาได้รับการอนุมัติ',
        redirectUrl: '/dashboard/user/history',
      }),
    );
  });

  it('HR rejects the cancellation: reason required, leave stays APPROVED, balance kept, employee told why', async () => {
    const id = await approvedLeave();
    await employee.deleteLeaveRequest(U.emp, id);

    await expect(hrReject(id)).rejects.toThrow(
      'A rejection reason is required',
    );
    await hrReject(id, 'อยู่ในช่วงปิดโปรเจกต์');

    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(approvalsOf(prisma, id).at(-1)).toEqual(
      expect.objectContaining({
        status: 'APPROVED',
        comment: 'อยู่ในช่วงปิดโปรเจกต์',
      }),
    );
    expect(balanceOf(prisma, 'emp-1', LT.sick.id)!.remainingDays).toBe(28);
    expect(notificationsFor(prisma, U.emp).at(-1)).toEqual(
      expect.objectContaining({
        type: 'REJECT',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest asymmetric matcher
        message: expect.stringContaining('อยู่ในช่วงปิดโปรเจกต์'),
      }),
    );
  });

  it('cannot cancel twice, cancel a cancelled leave, or cancel a still-pending request', async () => {
    const id = await approvedLeave();
    await employee.deleteLeaveRequest(U.emp, id);
    await expect(employee.deleteLeaveRequest(U.emp, id)).rejects.toThrow(
      'Cancellation request is already waiting for HR review',
    );
    await hrApprove(id);
    await expect(employee.deleteLeaveRequest(U.emp, id)).rejects.toThrow(
      ForbiddenException,
    );

    const pending = await submit(U.emp, LT.sick, {
      startDate: '2026-10-12',
      endDate: '2026-10-12',
    });
    await expect(
      employee.deleteLeaveRequest(U.emp, pending.id),
    ).rejects.toThrow(ForbiddenException);
  });

  it('cannot cancel someone else’s leave, or a leave that has already started', async () => {
    const id = await approvedLeave();
    await expect(employee.deleteLeaveRequest(U.emp2, id)).rejects.toThrow(
      NotFoundException,
    );

    jest.setSystemTime(new Date('2026-10-05T03:00:00.000Z')); // first day of the leave
    try {
      await expect(employee.deleteLeaveRequest(U.emp, id)).rejects.toThrow(
        'Cannot cancel an approved leave on or after its start date',
      );
    } finally {
      jest.setSystemTime(TODAY);
    }
  });
});

// =============================================================================
describe('FLOW 6 — Manager sick leave (HR → CEO)', () => {
  it('manager can submit; HR (not the CEO) is notified first', async () => {
    const { id, status } = await submit(U.mgr, LT.sick);
    expect(status).toBe('PENDING_VERIFY');
    expect(notificationsFor(prisma, U.hr)).toHaveLength(1);
    expect(notificationsFor(prisma, U.ceo)).toHaveLength(0);
    expect(leaveOf(prisma, id).employeeId).toBe('emp-mgr');
  });

  it('HR approval routes a manager straight to PENDING_EXECUTIVE and notifies the CEO', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    await hrApprove(id);

    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');
    expect(approvalsOf(prisma, id)).toEqual([
      expect.objectContaining({
        approverId: U.hr,
        status: 'PENDING_EXECUTIVE',
      }),
    ]);
    expect(notificationsFor(prisma, U.ceo)).toEqual([
      expect.objectContaining({
        title: 'มีคำขอลารอผู้บริหารอนุมัติ',
        redirectUrl: '/dashboard/ceo/approval',
      }),
    ]);
    expect(emailsTo(mail, 'ceo@nid.test')).toHaveLength(1);
  });

  it('an ordinary employee is NOT routed through the executive path', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);
    expect(leaveOf(prisma, id).status).toBe('PENDING_SUPERVISOR');
  });

  it('the department manager step is skipped: manager endpoint cannot act on it', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    await hrApprove(id);
    await expect(mgrApprove(id)).rejects.toThrow(
      'Invalid request or already processed',
    );
  });

  it('CEO approval makes it APPROVED, deducts balance and notifies the manager + HR', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    await hrApprove(id);
    prisma.state.notifications.length = 0;
    await ceoApprove(id);

    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(balanceOf(prisma, 'emp-mgr', LT.sick.id)!.remainingDays).toBe(28);
    expect(notificationsFor(prisma, U.mgr)).toEqual([
      expect.objectContaining({
        type: 'APPROVE',
        redirectUrl: '/dashboard/manager/history',
      }),
    ]);
    expect(notificationsFor(prisma, U.hr)).toHaveLength(1);
  });

  it('[FLOW] after HR approval the manager is told it now waits for the executive (not a department head)', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    prisma.state.notifications.length = 0;
    await hrApprove(id);

    const note = notificationsFor(prisma, U.mgr)[0];
    expect(note.message).toContain('ผู้บริหาร');
    expect(note.redirectUrl).toBe('/dashboard/manager/history');
  });
});

// =============================================================================
describe('FLOW 7 — Manager sick leave rejected by the CEO', () => {
  it('REJECTED with the reason logged; balance untouched; manager notified; no further approval possible', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    await hrApprove(id);
    prisma.state.notifications.length = 0;
    await ceoReject(id, 'ขาดคนดูแลทีม');

    const row = leaveOf(prisma, id);
    expect(row.status).toBe('REJECTED');
    expect(row.employeeId).toBe('emp-mgr');
    expect(approvalsOf(prisma, id).at(-1)).toEqual(
      expect.objectContaining({
        approverId: U.ceo,
        status: 'REJECTED',
        comment: 'ขาดคนดูแลทีม',
      }),
    );
    expect(balanceOf(prisma, 'emp-mgr', LT.sick.id)!.remainingDays).toBe(30);
    expect(notificationsFor(prisma, U.mgr)).toEqual([
      expect.objectContaining({
        type: 'REJECT',
        redirectUrl: '/dashboard/manager/history',
      }),
    ]);
    expect(emailsTo(mail, 'mgr@nid.test').at(-1)![2]).toContain('ขาดคนดูแลทีม');

    await expect(ceoApprove(id)).rejects.toThrow(
      'Request is not waiting for CEO approval',
    );
    await expect(ceoReject(id, 'again')).rejects.toThrow(
      'Request is not waiting for CEO approval',
    );
  });
});

// =============================================================================
describe('FLOW 8 — Manager personal-business leave (ลากิจ)', () => {
  it('matches the documented order Manager → HR → CEO → APPROVED', async () => {
    const { id } = await submit(U.mgr, LT.business);
    await hrApprove(id);
    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');
    await ceoApprove(id);
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(approvalsOf(prisma, id).map((a) => a.approverId)).toEqual([
      U.hr,
      U.ceo,
    ]);
  });
});

// =============================================================================
describe('FLOW 9 — Manager other leave', () => {
  it('HR → CEO approve path', async () => {
    const { id } = await submit(U.mgr, LT.ordination);
    await hrApprove(id);
    await ceoApprove(id);
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(balanceOf(prisma, 'emp-mgr', LT.ordination.id)!.remainingDays).toBe(
      118,
    );
  });

  it('HR reject needs a reason, sets REJECTED, and the manager can submit again', async () => {
    const { id } = await submit(U.mgr, LT.ordination);
    await expect(hrReject(id, '   ')).rejects.toThrow(
      'A rejection reason is required',
    );
    await hrReject(id, 'ขาดหนังสือรับรอง');
    expect(leaveOf(prisma, id).status).toBe('REJECTED');
    expect(approvalsOf(prisma, id)[0].comment).toBe('ขาดหนังสือรับรอง');

    const again = await submit(U.mgr, LT.ordination);
    expect(again.status).toBe('PENDING_VERIFY');
  });

  it('[FLOW] a manager rejected by HR is sent to their own history page', async () => {
    const { id } = await submit(U.mgr, LT.ordination);
    prisma.state.notifications.length = 0;
    await hrReject(id, 'ขาดหนังสือรับรอง');
    expect(notificationsFor(prisma, U.mgr)[0].redirectUrl).toBe(
      '/dashboard/manager/history',
    );
  });
});

// =============================================================================
describe('FLOW 10 — Manager cancels an approved leave', () => {
  async function approvedManagerLeave() {
    const { id } = await submit(U.mgr, LT.sick);
    await approveFully(id);
    await employee.deleteLeaveRequest(U.mgr, id);
    prisma.state.notifications.length = 0;
    return id;
  }

  it('HR approves: CANCELLED, balance refunded, manager notified on the manager history page', async () => {
    const id = await approvedManagerLeave();
    await hrApprove(id);

    expect(leaveOf(prisma, id).status).toBe('CANCELLED');
    expect(balanceOf(prisma, 'emp-mgr', LT.sick.id)!.remainingDays).toBe(30);
    expect(notificationsFor(prisma, U.mgr)).toEqual([
      expect.objectContaining({
        type: 'APPROVE',
        redirectUrl: '/dashboard/manager/history',
      }),
    ]);
  });

  it('HR rejects: stays APPROVED, reason logged, manager notified', async () => {
    const id = await approvedManagerLeave();
    await hrReject(id, 'ต้องอยู่ประชุมบอร์ด');

    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(approvalsOf(prisma, id).at(-1)!.comment).toBe('ต้องอยู่ประชุมบอร์ด');
    expect(balanceOf(prisma, 'emp-mgr', LT.sick.id)!.remainingDays).toBe(28);
    expect(notificationsFor(prisma, U.mgr)).toEqual([
      expect.objectContaining({
        type: 'REJECT',
        redirectUrl: '/dashboard/manager/history',
      }),
    ]);
  });
});

// =============================================================================
describe('Authorization inside the services', () => {
  it('HR cannot review their own leave (verify or open)', async () => {
    const { id } = await submit(U.hr, LT.sick);
    await expect(hrApprove(id, U.hr)).rejects.toThrow(
      'คุณไม่สามารถตรวจสอบคำขอลาของตนเองได้',
    );
    await expect(hr.markAsViewed(U.hr, id)).rejects.toThrow(
      'คุณไม่สามารถตรวจสอบคำขอลาของตนเองได้',
    );
  });

  it('a request locked by one HR cannot be decided by another HR', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hr.markAsViewed(U.hr, id);
    expect(leaveOf(prisma, id)).toEqual(
      expect.objectContaining({
        status: 'REVIEWING_HR',
        currentHrReviewerId: U.hr,
      }),
    );

    await expect(hrApprove(id, U.hr2)).rejects.toThrow(
      'คำขอนี้กำลังถูกตรวจสอบโดย HR คนอื่น',
    );
    await expect(hr.markAsViewed(U.hr2, id)).rejects.toThrow(
      'คำขอนี้กำลังถูกตรวจสอบโดย HR คนอื่น',
    );
    await hrApprove(id, U.hr);
    expect(leaveOf(prisma, id).status).toBe('PENDING_SUPERVISOR');
  });

  it('an HR user holding one lock cannot take a second request', async () => {
    const a = await submit(U.emp, LT.sick);
    const b = await submit(U.emp2, LT.sick);
    await hr.markAsViewed(U.hr, a.id);
    await expect(hr.markAsViewed(U.hr, b.id)).rejects.toThrow(
      'คุณมีรายการคำขออื่นที่กำลังตรวจสอบอยู่',
    );
  });

  it('a manager cannot approve a request from another department', async () => {
    const { id } = await submit(U.empOtherDept, LT.sick);
    await hrApprove(id);
    await expect(mgrApprove(id, U.mgr)).rejects.toThrow(
      'Employee is not in your department',
    );
    await mgrApprove(id, U.mgrOtherDept);
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
  });

  it('a plain HR officer cannot use manager approval; an HR department head can', async () => {
    const { id } = await submit(U.hr2, LT.sick); // HR officer's own leave → HR dept
    await hrApprove(id, U.hr);
    expect(leaveOf(prisma, id).status).toBe('PENDING_SUPERVISOR');

    await expect(
      manager.processRequest(U.hr, id, 'Approve', {}),
    ).rejects.toThrow(ForbiddenException);
    await manager.processRequest(U.hrLeader, id, 'Approve', {});
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
  });

  it('[FLOW] a manager cannot approve their own request', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    // Put the manager's own request in the department-approval queue.
    Object.assign(leaveOf(prisma, id), { status: 'PENDING_SUPERVISOR' });
    await expect(mgrApprove(id, U.mgr)).rejects.toThrow();
    expect(leaveOf(prisma, id).status).toBe('PENDING_SUPERVISOR');
  });

  it('[FLOW] the CEO cannot give final approval to their own leave', async () => {
    const { id } = seedCeoLeave(LT.sick);
    await hrApprove(id);
    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');
    await expect(ceoApprove(id, U.ceo)).rejects.toThrow();
    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');
  });

  // Business rule confirmed 2026-09-24: a "Leader" position IS a department
  // head, so like any manager their leave goes HR → CEO.
  it('business rule: a "Leader" is a department head — their leave goes HR → CEO', async () => {
    const { id } = await submit(U.leaderEmp, LT.sick);
    await hrApprove(id);
    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');
  });
});

// =============================================================================
describe('Half-day portions through createLeaveRequest', () => {
  const half = (period: 'morning' | 'afternoon') => ({
    leaveMode: 'half_day' as const,
    period,
    startDate: START,
    endDate: START,
  });
  const full = {
    leaveMode: 'full_day' as const,
    startDate: START,
    endDate: START,
  };

  it('morning + afternoon on the same day are both accepted (0.5 day each)', async () => {
    const a = await submit(U.emp, LT.sick, half('morning'));
    const b = await submit(U.emp, LT.sick, half('afternoon'));
    expect([a.totalDays, b.totalDays]).toEqual([0.5, 0.5]);
    expect(leaveOf(prisma, a.id).days).toEqual([
      expect.objectContaining({ portion: 'morning' }),
    ]);
    expect(leaveOf(prisma, b.id).days).toEqual([
      expect.objectContaining({ portion: 'afternoon' }),
    ]);
  });

  it.each([
    ['morning', 'morning', half('morning'), half('morning')],
    ['afternoon', 'afternoon', half('afternoon'), half('afternoon')],
    ['full day', 'morning', full, half('morning')],
    ['full day', 'afternoon', full, half('afternoon')],
    ['full day', 'full day', full, full],
  ])('existing %s + new %s is refused', async (_a, _b, first, second) => {
    await submit(U.emp, LT.sick, first);
    await expect(submit(U.emp, LT.sick, second)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.state.leaveRequests).toHaveLength(1);
  });

  it('a rejected leave no longer blocks the slot', async () => {
    const first = await submit(U.emp, LT.sick, full);
    await hrReject(first.id, 'x');
    await expect(submit(U.emp, LT.sick, full)).resolves.toEqual(
      expect.objectContaining({ totalDays: 1 }),
    );
  });
});

// =============================================================================
describe('Edge cases', () => {
  it('user without an employee profile cannot submit', async () => {
    await expect(submit(U.noEmployee, LT.sick)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('unknown leave type / missing balance row is refused', async () => {
    await expect(
      submit(U.emp, { ...LT.sick, id: 'lt-does-not-exist' }),
    ).rejects.toThrow('Leave balance not found');

    build({ balanceOverrides: { 'emp-1': { [LT.sick.id]: null } } });
    await expect(submit(U.emp, LT.sick)).rejects.toThrow(
      'Leave balance not found',
    );
  });

  it('end date before start date is refused', async () => {
    await expect(
      submit(U.emp, LT.sick, {
        startDate: '2026-10-06',
        endDate: '2026-10-05',
      }),
    ).rejects.toThrow('Start date must be before or equal to end date');
  });

  it('a weekend-only range (0 working days) is refused', async () => {
    await expect(
      submit(U.emp, LT.sick, {
        startDate: '2026-10-03',
        endDate: '2026-10-04',
      }),
    ).rejects.toThrow('จำนวนวันลาเป็น 0');
  });

  it('invalid date strings are rejected by DTO validation before reaching the service', async () => {
    const dto = plainToInstance(CreateLeaveRequestDto, {
      leaveTypeId: LT.sick.id,
      startDate: 'not-a-date',
      endDate: '2026-13-45',
      reason: 'x',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['startDate', 'endDate']),
    );
  });

  it('annual leave requires one year of tenure', async () => {
    build({
      employees: [
        {
          id: 'emp-new',
          userId: U.emp,
          firstName: 'ใหม่',
          lastName: 'ทดสอบ',
          departmentId: 'dept-dev',
          positionName: 'Programmer',
          gender: 'Female',
          hireDate: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    });
    await expect(submit(U.emp, LT.vacation)).rejects.toThrow(
      'คุณต้องมีอายุงานครบ 1 ปี',
    );
  });

  it('non-existent request ids are refused at every decision point', async () => {
    await expect(hrApprove('nope')).rejects.toThrow(BadRequestException);
    await expect(mgrApprove('nope')).rejects.toThrow(BadRequestException);
    await expect(ceoApprove('nope')).rejects.toThrow(BadRequestException);
    await expect(employee.deleteLeaveRequest(U.emp, 'nope')).rejects.toThrow(
      NotFoundException,
    );
    await expect(hr.markAsViewed(U.hr, 'nope')).rejects.toThrow(
      'Request not found',
    );
  });

  it('approving twice is refused (HR, manager, CEO)', async () => {
    const { id } = await submit(U.emp, LT.vacation);
    await hrApprove(id);
    await expect(hrApprove(id)).rejects.toThrow(
      'Invalid request or already verified',
    );
    await mgrApprove(id);
    await expect(mgrApprove(id)).rejects.toThrow(
      'Invalid request or already processed',
    );
    await ceoApprove(id);
    await expect(ceoApprove(id)).rejects.toThrow(
      'Request is not waiting for CEO approval',
    );
    expect(balanceOf(prisma, 'emp-1', LT.vacation.id)!.remainingDays).toBe(4);
  });

  it('final approval refuses when HR has since reduced the balance below the request', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);
    balanceOf(prisma, 'emp-1', LT.sick.id)!.remainingDays = 1;
    await expect(mgrApprove(id)).rejects.toThrow('Insufficient leave balance');
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('manager or CEO user without an employee profile is refused', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);
    await expect(mgrApprove(id, U.noEmployee)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('with no HR users the request is still created, but nobody is told to review it', async () => {
    build({
      users: [
        { id: U.emp, email: 'emp@nid.test', role: 'Employee' },
        { id: U.mgr, email: 'mgr@nid.test', role: 'Manager' },
      ],
    });
    const created = await submit(U.emp, LT.sick);
    expect(created.status).toBe('PENDING_VERIFY');
    expect(prisma.state.notifications).toHaveLength(0);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it('[FLOW] a leave waiting for a department head is notified to someone when the department has no "Manager" user', async () => {
    // HR department has an HR "Manager"-position head but no user with role Manager.
    const { id } = await submit(U.hr2, LT.sick);
    prisma.state.notifications.length = 0;
    await hrApprove(id, U.hr);

    expect(leaveOf(prisma, id).status).toBe('PENDING_SUPERVISOR');
    expect(notificationsFor(prisma, U.hrLeader).length).toBeGreaterThan(0);
  });

  it('[FLOW] HR editing another employee’s pending leave checks the OWNER’s balance, not the editor’s', async () => {
    const { id } = await submit(U.emp, LT.sick);
    prisma.leaveBalance.findUnique.mockClear();

    await employee.updateLeaveRequest(U.hr, id, {
      leaveMode: 'full_day',
      startDate: '2026-10-07',
      endDate: '2026-10-07',
    });

    expect(prisma.leaveBalance.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest asymmetric matcher
          employeeId_leaveTypeId_year: expect.objectContaining({
            employeeId: 'emp-1',
          }),
        },
      }),
    );
  });
});

// =============================================================================
// Checks added with the fixes for the 9 reported mismatches.
describe('Fix checks — editing uses the leave owner (BUG 1)', () => {
  it('HR editing employee A’s leave is refused when A (not HR) lacks the balance', async () => {
    const { id } = await submit(U.emp, LT.business); // 2 of A's 3 days
    await expect(
      employee.updateLeaveRequest(U.hr, id, {
        leaveMode: 'full_day',
        startDate: '2026-10-05',
        endDate: '2026-10-08',
      }),
    ).rejects.toThrow('สิทธิ์วันลาไม่เพียงพอ (เหลือเพียง 3 วัน)');
  });

  it('HR editing employee A’s leave checks overlaps against A’s other leaves', async () => {
    await submit(U.emp, LT.sick, {
      startDate: '2026-10-07',
      endDate: '2026-10-07',
    });
    const { id } = await submit(U.emp, LT.sick);

    await expect(
      employee.updateLeaveRequest(U.hr, id, {
        leaveMode: 'full_day',
        startDate: '2026-10-07',
        endDate: '2026-10-07',
      }),
    ).rejects.toThrow(BadRequestException);
    const lastQuery = prisma.leaveRequest.findMany.mock.calls.at(-1)![0] as {
      where: { employeeId?: string; id?: unknown };
    };
    expect(lastQuery.where.employeeId).toBe('emp-1');
    expect(lastQuery.where.id).toEqual({ not: id });
  });

  it('HR editing employee A’s leave recalculates days and paid days for A', async () => {
    const { id } = await submit(U.emp, LT.sick);
    const updated = await employee.updateLeaveRequest(U.hr, id, {
      leaveMode: 'full_day',
      startDate: '2026-10-07',
      endDate: '2026-10-09',
    });
    expect(updated).toEqual(
      expect.objectContaining({
        totalDays: 3,
        paidDays: 3,
        employeeId: 'emp-1',
      }),
    );
    expect(leaveOf(prisma, id).days).toHaveLength(3);
  });
});

describe('Fix checks — no self-approval (BUG 2, 3)', () => {
  it('a manager cannot reject their own request either, and nothing is written', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    Object.assign(leaveOf(prisma, id), { status: 'PENDING_SUPERVISOR' });
    await expect(mgrReject(id, 'x', U.mgr)).rejects.toThrow(ForbiddenException);
    expect(prisma.leaveApproval.create).not.toHaveBeenCalled();
  });

  it('the CEO cannot reject their own leave; it stays waiting', async () => {
    const { id } = seedCeoLeave(LT.sick);
    await hrApprove(id);
    await expect(ceoReject(id, 'x', U.ceo)).rejects.toThrow(ForbiddenException);
    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');
  });

  it('manager and CEO still decide other people’s requests normally', async () => {
    const a = await submit(U.emp, LT.sick);
    await hrApprove(a.id);
    await mgrApprove(a.id, U.mgr);
    expect(leaveOf(prisma, a.id).status).toBe('APPROVED');

    const b = await submit(U.mgr, LT.business);
    await hrApprove(b.id);
    await ceoApprove(b.id, U.ceo);
    expect(leaveOf(prisma, b.id).status).toBe('APPROVED');
  });
});

describe('Fix checks — department approver lookup (BUG 4)', () => {
  it('normal department: the role-Manager user is notified; other departments’ HR heads are not', async () => {
    const { id } = await submit(U.emp, LT.sick);
    prisma.state.notifications.length = 0;
    await hrApprove(id);
    expect(notificationsFor(prisma, U.mgr)).toHaveLength(1);
    expect(notificationsFor(prisma, U.hrLeader)).toHaveLength(0);
  });

  it('no role-Manager but an HR department head: that head is notified, a plain HR officer is not', async () => {
    const { id } = await submit(U.hr2, LT.sick);
    prisma.state.notifications.length = 0;
    mail.sendEmail.mockClear();
    await hrApprove(id, U.hr);

    expect(notificationsFor(prisma, U.hrLeader)).toEqual([
      expect.objectContaining({
        type: 'NEW_ORDER',
        redirectUrl: '/dashboard/manager/approve',
      }),
    ]);
    expect(
      notificationsFor(prisma, U.hr).filter((n) => n.type === 'NEW_ORDER'),
    ).toHaveLength(0);
    expect(emailsTo(mail, 'hr-lead@nid.test')).toHaveLength(1);
  });

  it('no approver at all: the request moves on and every HR user is warned instead of silence', async () => {
    const hire = new Date('2020-01-15T00:00:00.000Z');
    build({
      employees: [
        {
          id: 'emp-lonely',
          userId: U.emp,
          firstName: 'โดดเดี่ยว',
          lastName: 'ทดสอบ',
          departmentId: 'dept-empty',
          positionName: 'Programmer',
          gender: 'Female',
          hireDate: hire,
        },
        {
          id: 'emp-hr',
          userId: U.hr,
          firstName: 'ฮาน่า',
          lastName: 'ทดสอบ',
          departmentId: 'dept-hr',
          positionName: 'HR Officer',
          gender: 'Female',
          hireDate: hire,
        },
      ],
    });
    const { id } = await submit(U.emp, LT.sick);
    prisma.state.notifications.length = 0;
    await hrApprove(id);

    expect(leaveOf(prisma, id).status).toBe('PENDING_SUPERVISOR');
    const warning = notificationsFor(prisma, U.hr).find(
      (n) => n.title === 'ไม่พบหัวหน้าแผนกที่อนุมัติคำขอลาได้',
    );
    expect(warning?.message).toContain('โดดเดี่ยว');
    expect(warning?.message).toContain('ลาป่วย');
  });
});

describe('Fix checks — notification wording and links (BUG 5–9)', () => {
  it.each([
    ['ลาพักผ่อนประจำปี', LT.vacation],
    ['ลาอุปสมบท', LT.ordination],
  ])(
    'forwarding %s to the CEO names that leave type in the e-mail',
    async (_n, lt) => {
      const { id } = await submit(U.emp, lt);
      await hrApprove(id);
      mail.sendEmail.mockClear();
      await mgrApprove(id);
      const [, subject, body] = emailsTo(mail, 'ceo@nid.test')[0];
      expect(subject).toContain(lt.name);
      expect(body).toContain(lt.name);
    },
  );

  it.each([
    ['ลาป่วย', LT.sick],
    ['ลากิจ', LT.business],
  ])('%s is final at the manager and never e-mails the CEO', async (_n, lt) => {
    const { id } = await submit(U.emp, lt);
    await hrApprove(id);
    mail.sendEmail.mockClear();
    await mgrApprove(id);
    expect(emailsTo(mail, 'ceo@nid.test')).toHaveLength(0);
  });

  it('reject notices name the leave type, who rejected and why; e-mails keep the reason', async () => {
    const a = await submit(U.emp, LT.sick);
    await hrApprove(a.id);
    prisma.state.notifications.length = 0;
    await mgrReject(a.id, 'งานเร่ง');
    const mgrNote = notificationsFor(prisma, U.emp)[0].message;
    expect(mgrNote).toContain('ลาป่วย');
    expect(mgrNote).toContain('หัวหน้าแผนก');
    expect(mgrNote).toContain('เหตุผล: งานเร่ง');

    const b = await submit(U.mgr, LT.sick, {
      startDate: '2026-10-12',
      endDate: '2026-10-12',
    });
    await hrApprove(b.id);
    prisma.state.notifications.length = 0;
    mail.sendEmail.mockClear();
    await ceoReject(b.id, 'ปิดงบ');
    const ceoNote = notificationsFor(prisma, U.mgr)[0].message;
    expect(ceoNote).toContain('ลาป่วย');
    expect(ceoNote).toContain('ผู้บริหาร');
    expect(ceoNote).toContain('เหตุผล: ปิดงบ');
    expect(emailsTo(mail, 'mgr@nid.test')[0][2]).toContain('ปิดงบ');
  });

  it('HR approval tells an employee they now wait for the department head, on the user page', async () => {
    const { id } = await submit(U.emp, LT.sick);
    prisma.state.notifications.length = 0;
    await hrApprove(id);
    expect(notificationsFor(prisma, U.emp)[0]).toEqual(
      expect.objectContaining({
        message: 'คำขอลาของคุณกำลังรอการอนุมัติจากหัวหน้าแผนก',
        redirectUrl: '/dashboard/user/history',
      }),
    );
  });

  it('links follow the requester’s role for HR officer and CEO requests', async () => {
    const hrLeave = await submit(U.hr2, LT.sick);
    prisma.state.notifications.length = 0;
    await hrReject(hrLeave.id, 'x', U.hr);
    expect(notificationsFor(prisma, U.hr2)[0].redirectUrl).toBe(
      '/dashboard/hr/leave-history',
    );

    const ceoLeave = seedCeoLeave(LT.sick);
    prisma.state.notifications.length = 0;
    await hrApprove(ceoLeave.id);
    expect(notificationsFor(prisma, U.ceo).at(-1)).toEqual(
      expect.objectContaining({
        message: 'คำขอลาของคุณกำลังรอการอนุมัติจากผู้บริหาร (CEO)',
        redirectUrl: '/dashboard/ceo/dashboard',
      }),
    );
  });

  it('an HR employee’s decision from their department head links to the HR history page', async () => {
    const { id } = await submit(U.hr2, LT.sick);
    await hrApprove(id, U.hr);
    prisma.state.notifications.length = 0;
    await manager.processRequest(U.hrLeader, id, 'Approve', {});
    expect(notificationsFor(prisma, U.hr2)[0]).toEqual(
      expect.objectContaining({
        type: 'APPROVE',
        redirectUrl: '/dashboard/hr/leave-history',
      }),
    );
  });
});

describe('Business rule — the CEO does not file leave, but still approves managers', () => {
  it('CEO cannot submit a leave request', async () => {
    const attempt = submit(U.ceo, LT.sick);
    await expect(attempt).rejects.toThrow(ForbiddenException);
    await expect(submit(U.ceo, LT.vacation)).rejects.toThrow(
      'ผู้บริหาร (CEO) ไม่ต้องยื่นคำขอลาในระบบ',
    );

    expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(prisma.state.leaveRequests).toHaveLength(0);
    expect(prisma.state.approvals).toHaveLength(0);
    expect(prisma.state.notifications).toHaveLength(0);
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('CEO still approves a manager leave (Manager → HR → CEO → APPROVED)', async () => {
    const { id } = await submit(U.mgr, LT.business);
    await hrApprove(id);
    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');

    await ceoApprove(id);
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(approvalsOf(prisma, id).at(-1)).toEqual(
      expect.objectContaining({ approverId: U.ceo, status: 'APPROVED' }),
    );
    expect(balanceOf(prisma, 'emp-mgr', LT.business.id)!.remainingDays).toBe(
      LT.business.defaultDays - 2,
    );
  });

  it('CEO still rejects a manager leave with a reason that reaches the manager', async () => {
    const { id } = await submit(U.mgr, LT.business);
    await hrApprove(id);
    prisma.state.notifications.length = 0;

    await ceoReject(id, 'ช่วงนี้มีงานเร่งด่วน');
    expect(leaveOf(prisma, id).status).toBe('REJECTED');
    expect(approvalsOf(prisma, id).at(-1)).toEqual(
      expect.objectContaining({
        approverId: U.ceo,
        status: 'REJECTED',
        comment: 'ช่วงนี้มีงานเร่งด่วน',
      }),
    );
    expect(notificationsFor(prisma, U.mgr)[0].message).toContain(
      'เหตุผล: ช่วงนี้มีงานเร่งด่วน',
    );
    expect(emailsTo(mail, 'mgr@nid.test').at(-1)![2]).toContain(
      'ช่วงนี้มีงานเร่งด่วน',
    );
  });
});

describe('Concurrency — a double click cannot approve (or deduct) twice', () => {
  it('department head: two simultaneous approvals → one succeeds, one refused; deducted once, logged once', async () => {
    const { id } = await submit(U.emp, LT.sick); // 2 days, not special → final at the manager
    await hrApprove(id);
    const results = await Promise.allSettled([
      mgrApprove(id, U.mgr),
      mgrApprove(id, U.mgr),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(balanceOf(prisma, 'emp-1', LT.sick.id)!.remainingDays).toBe(28);
    expect(
      approvalsOf(prisma, id).filter((a) => a.approverId === U.mgr),
    ).toHaveLength(1);
  });

  it('department head: approve and reject at the same moment → only the first decision counts', async () => {
    const { id } = await submit(U.emp, LT.sick);
    await hrApprove(id);
    const results = await Promise.allSettled([
      mgrApprove(id, U.mgr),
      mgrReject(id, 'ไม่สะดวก', U.mgr),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      approvalsOf(prisma, id).filter((a) => a.approverId === U.mgr),
    ).toHaveLength(1);
  });

  it('CEO: two simultaneous approvals of a manager leave → deducted once, logged once', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    await hrApprove(id);
    const results = await Promise.allSettled([ceoApprove(id), ceoApprove(id)]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
    expect(balanceOf(prisma, 'emp-mgr', LT.sick.id)!.remainingDays).toBe(28);
    expect(
      approvalsOf(prisma, id).filter((a) => a.approverId === U.ceo),
    ).toHaveLength(1);
  });

  it('the losing click gets a clear "already processed" error', async () => {
    const { id } = await submit(U.mgr, LT.sick);
    await hrApprove(id);
    const [, second] = await Promise.allSettled([
      ceoApprove(id),
      ceoApprove(id),
    ]);
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(
      BadRequestException,
    );
  });
});
