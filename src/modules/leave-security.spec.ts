/// <reference types="jest" />
/**
 * IDOR / ownership checks inside the leave services (the route-level role
 * matrix lives in auth/guards/route-security.spec.ts).
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmployeeMutationService } from './employee/services/employee-mutation.service';
import { EmployeeQueryService } from './employee/services/employee-query.service';
import { HrLeaveVerificationService } from './hr/services/hr-leave-verification.service';
import { ManagerService } from './manager/manager.service';
import {
  LT,
  U,
  TODAY,
  createFakePrisma,
  defaultOrg,
  createNotificationMock,
  leaveOf,
  FakePrisma,
} from '../test-utils/leave-flow.fixtures';

let prisma: FakePrisma;
let employee: EmployeeMutationService;
let hr: HrLeaveVerificationService;

beforeAll(() => {
  jest.useFakeTimers({ now: TODAY, doNotFake: ['nextTick', 'setImmediate'] });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
beforeEach(() => {
  prisma = createFakePrisma();
  const mail = createNotificationMock();
  employee = new EmployeeMutationService(prisma as never, mail as never);
  hr = new HrLeaveVerificationService(prisma as never, mail as never);
});

const submit = (userId: string) =>
  employee.createLeaveRequest(userId, {
    leaveTypeId: LT.sick.id,
    leaveMode: 'full_day',
    startDate: '2026-10-05',
    endDate: '2026-10-06',
    reason: 'ทดสอบระบบ',
  });

describe('IDOR — editing a leave', () => {
  it('employee A cannot edit employee B’s pending leave; B’s row is untouched', async () => {
    const { id } = await submit(U.emp2);
    const before = { ...leaveOf(prisma, id) };
    await expect(
      employee.updateLeaveRequest(U.emp, id, { reason: 'hijack' }),
    ).rejects.toThrow(ForbiddenException);
    expect(leaveOf(prisma, id)).toEqual(before);
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('an employee from another department cannot edit it either', async () => {
    const { id } = await submit(U.emp);
    await expect(
      employee.updateLeaveRequest(U.empOtherDept, id, { reason: 'x' }),
    ).rejects.toThrow(
      'You do not have permission to update this leave request',
    );
  });

  it('business rule: a department head cannot edit a subordinate’s leave waiting for HR', async () => {
    const { id } = await submit(U.emp); // U.mgr heads U.emp's department
    const before = { ...leaveOf(prisma, id) };
    await expect(
      employee.updateLeaveRequest(U.mgr, id, { reason: 'by manager' }),
    ).rejects.toThrow(
      'You do not have permission to update this leave request',
    );
    expect(leaveOf(prisma, id)).toEqual(before);
  });

  it('business rule: HR and the CEO may still edit it', async () => {
    const { id } = await submit(U.emp);
    await employee.updateLeaveRequest(U.hr, id, { reason: 'แก้โดย HR' });
    expect(leaveOf(prisma, id).reason).toBe('แก้โดย HR');
    await employee.updateLeaveRequest(U.ceo, id, { reason: 'แก้โดย CEO' });
    expect(leaveOf(prisma, id).reason).toBe('แก้โดย CEO');
  });

  it('editing a non-existent leave is "not found"', async () => {
    await expect(
      employee.updateLeaveRequest(U.emp, 'leave-404', { reason: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it.each(['PENDING_SUPERVISOR', 'PENDING_EXECUTIVE', 'APPROVED', 'CANCELLED'])(
    'the owner cannot edit once the leave is %s',
    async (status) => {
      const { id } = await submit(U.emp);
      Object.assign(leaveOf(prisma, id), { status });
      await expect(
        employee.updateLeaveRequest(U.emp, id, { reason: 'x' }),
      ).rejects.toThrow(
        'สามารถแก้ไขข้อมูลได้เฉพาะคำขอที่ยังไม่ผ่านการตรวจสอบจาก HR เท่านั้น',
      );
    },
  );

  it('the owner editing while HR is reviewing sends it back to PENDING_VERIFY', async () => {
    const { id } = await submit(U.emp);
    Object.assign(leaveOf(prisma, id), {
      status: 'REVIEWING_HR',
      currentHrReviewerId: U.hr,
    });
    await employee.updateLeaveRequest(U.emp, id, { reason: 'แก้เหตุผล' });
    expect(leaveOf(prisma, id)).toEqual(
      expect.objectContaining({
        status: 'PENDING_VERIFY',
        reason: 'แก้เหตุผล',
      }),
    );
  });
});

describe('IDOR — cancelling a leave', () => {
  it('B’s approved leave looks "not found" to A, and stays APPROVED', async () => {
    const { id } = await submit(U.emp2);
    Object.assign(leaveOf(prisma, id), { status: 'APPROVED' });
    await expect(employee.deleteLeaveRequest(U.emp, id)).rejects.toThrow(
      NotFoundException,
    );
    expect(leaveOf(prisma, id).status).toBe('APPROVED');
  });
});

describe('IDOR — HR review lock', () => {
  it('HR cannot open or decide their own leave', async () => {
    const { id } = await submit(U.hr2);
    await expect(
      hr.processLeaveRequest(U.hr2, id, 'Approve', {}),
    ).rejects.toThrow();
    expect(leaveOf(prisma, id).status).toBe('PENDING_VERIFY');
  });
});

describe('Data scoping of the read endpoints', () => {
  function queryService() {
    const p = {
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'emp-1', departmentId: 'dept-dev' }),
      },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { p, q: new EmployeeQueryService(p as never) };
  }

  it('/leave/history returns only the caller’s own leaves', async () => {
    const { p, q } = queryService();
    await q.getLeaveHistory('u-emp');
    expect(p.employee.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-emp' } }),
    );
    expect(p.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: 'emp-1' } }),
    );
  });

  it('/leave/department is limited to the caller’s own department', async () => {
    const { p, q } = queryService();
    await q.getDepartmentLeaves('u-emp');
    expect(p.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employee: { departmentId: 'dept-dev' } },
      }),
    );
  });

  it('/leave/department returns nothing for an employee without a department', async () => {
    const { p, q } = queryService();
    p.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      departmentId: null,
    });
    await expect(q.getDepartmentLeaves('u-emp')).resolves.toEqual([]);
    expect(p.leaveRequest.findMany).not.toHaveBeenCalled();
  });

  it('/leave/all-leaves (company calendar) returns approved leaves only', async () => {
    const { p, q } = queryService();
    await q.getAllCompanyLeaves();
    expect(p.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ status: 'APPROVED' }, { status: 'Approved' }] },
      }),
    );
  });
});

describe('Attachments (e.g. medical certificates) reach only people entitled to them', () => {
  function includeOf(p: { leaveRequest: { findMany: jest.Mock } }) {
    return (
      (p.leaveRequest.findMany.mock.calls as unknown[][])[0][0] as {
        include: Record<string, unknown>;
      }
    ).include;
  }
  function queryService() {
    const p = {
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'emp-1', departmentId: 'dept-dev' }),
      },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { p, q: new EmployeeQueryService(p as never) };
  }

  it.each([
    ['/leave/department', 'getDepartmentLeaves'],
    ['/leave/all-leaves', 'getAllCompanyLeaves'],
  ] as const)(
    '%s (colleagues’ leaves) never selects attachments',
    async (_route, method) => {
      const { p, q } = queryService();
      await q[method]('u-emp');
      const include = includeOf(p);
      expect(include).not.toHaveProperty('attachments');
      // the calendar still gets what it needs
      expect(include).toHaveProperty('leaveType', true);
      expect(include).toHaveProperty('employee');
    },
  );

  it('/leave/history (the caller’s own leaves) still includes attachments', async () => {
    const { p, q } = queryService();
    await q.getLeaveHistory('u-emp');
    expect(includeOf(p)).toHaveProperty('attachments', true);
  });
});

describe('Business rule — calendars never carry the leave reason or approver comments', () => {
  const row = {
    id: 'l-1',
    reason: 'ป่วยเป็นไข้หวัดใหญ่',
    status: 'APPROVED',
    leaveType: { name: 'ลาป่วย' },
    employee: { firstName: 'สมศรี' },
  };
  function queryService() {
    const p = {
      employee: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'emp-1', departmentId: 'dept-dev' }),
      },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([{ ...row }]) },
    };
    return { p, q: new EmployeeQueryService(p as never) };
  }

  it.each(['getDepartmentLeaves', 'getAllCompanyLeaves'] as const)(
    '%s: no reason in the result and no approvals selected; calendar fields kept',
    async (method) => {
      const { p, q } = queryService();
      const out = (await q[method]('u-emp')) as Record<string, unknown>[];
      expect(out).toHaveLength(1);
      expect(out[0]).not.toHaveProperty('reason');
      expect(out[0]).toEqual(
        expect.objectContaining({
          id: 'l-1',
          status: 'APPROVED',
          leaveType: { name: 'ลาป่วย' },
        }),
      );
      const { include } = (
        p.leaveRequest.findMany.mock.calls as unknown[][]
      )[0][0] as {
        include: Record<string, unknown>;
      };
      expect(include).not.toHaveProperty('approvals');
      expect(include).not.toHaveProperty('attachments');
    },
  );

  it('/leave/history (own leaves) still returns the reason', async () => {
    const { q } = queryService();
    const out = (await q.getLeaveHistory('u-emp')) as Record<string, unknown>[];
    expect(out[0].reason).toBe('ป่วยเป็นไข้หวัดใหญ่');
  });
});

describe('Business rule — ONLY a "Leader" position is a department head', () => {
  function orgWithPositions(changes: Record<string, string>) {
    const org = defaultOrg();
    return createFakePrisma({
      ...org,
      employees: org.employees.map((e) =>
        changes[e.id] ? { ...e, positionName: changes[e.id] } : e,
      ),
    });
  }

  it('an employee titled "Project Manager" is routed like any employee (HR → department head), not to the CEO', async () => {
    prisma = orgWithPositions({ 'emp-1': 'Project Manager' });
    const mail = createNotificationMock();
    employee = new EmployeeMutationService(prisma as never, mail as never);
    hr = new HrLeaveVerificationService(prisma as never, mail as never);
    const { id } = await submit(U.emp);
    await hr.processLeaveRequest(U.hr, id, 'Approve', {});
    expect(leaveOf(prisma, id).status).toBe('PENDING_SUPERVISOR');
  });

  it('an employee in a "Leader" position is a department head: routed HR → CEO', async () => {
    prisma = orgWithPositions({ 'emp-1': 'Leader' });
    const mail = createNotificationMock();
    employee = new EmployeeMutationService(prisma as never, mail as never);
    hr = new HrLeaveVerificationService(prisma as never, mail as never);
    const { id } = await submit(U.emp);
    await hr.processLeaveRequest(U.hr, id, 'Approve', {});
    expect(leaveOf(prisma, id).status).toBe('PENDING_EXECUTIVE');
  });

  it('an HR user titled "HR Manager" may NOT use department-head approval; an HR "Leader" may', async () => {
    const mgrFor = (p: FakePrisma) =>
      new ManagerService(p as never, createNotificationMock() as never);

    const notHead = orgWithPositions({ 'emp-hr-lead': 'HR Manager' });
    await expect(
      mgrFor(notHead).getPendingRequests(U.hrLeader),
    ).rejects.toThrow(
      'Only HR department heads can access manager approval functions',
    );

    const head = orgWithPositions({ 'emp-hr-lead': 'Leader' });
    await expect(mgrFor(head).getPendingRequests(U.hrLeader)).resolves.toEqual(
      expect.any(Array),
    );
  });
});
