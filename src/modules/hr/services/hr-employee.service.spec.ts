/// <reference types="jest" />
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { HrEmployeeService } from './hr-employee.service';
import { roleForPosition } from './hr-assignable-role';

const YEAR = new Date().getFullYear();

function createPrisma() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    position: { findUnique: jest.fn() },
    role: { findFirst: jest.fn(), findUnique: jest.fn() },
    leaveType: { findMany: jest.fn() },
    leaveBalance: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  return Object.assign(prisma, {
    $transaction: jest.fn((fn: (tx: typeof prisma) => unknown) =>
      Promise.resolve(fn(prisma)),
    ),
  });
}
let prisma: ReturnType<typeof createPrisma>;
let service: HrEmployeeService;

beforeEach(() => {
  prisma = createPrisma();
  service = new HrEmployeeService(prisma as never);
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.create.mockResolvedValue({ id: 'u-new' });
  prisma.employee.create.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve({ id: 'emp-new', ...data }),
  );
  prisma.role.findFirst.mockImplementation(
    ({ where }: { where: { name: string } }) =>
      Promise.resolve({ id: `role-${where.name}` }),
  );
  // role ids in these tests are "role-<Name>"
  prisma.role.findUnique.mockImplementation(
    ({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, name: where.id.replace(/^role-/, '') }),
  );
  prisma.leaveType.findMany.mockResolvedValue([
    { id: 'lt-sick', name: 'ลาป่วย', defaultDays: 30 },
    { id: 'lt-vac', name: 'ลาพักผ่อน', defaultDays: 6 },
  ]);
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
});

const base = {
  email: 'new@nid.test',
  firstName: 'ใหม่',
  lastName: 'พนักงาน',
  departmentId: 'dept-dev',
  positionId: 'pos-dev',
};

describe('Business rule — HR can assign CEO but never Admin', () => {
  const ADMIN_MSG = 'ฝ่ายบุคคลไม่สามารถกำหนดสิทธิ์ผู้ดูแลระบบ (Admin) ได้';

  it.each([
    ['roleName', { roleName: 'Admin' }, null],
    ['roleId', { roleId: 'role-Admin' }, null],
    [
      'a position whose role is Admin',
      {},
      { id: 'pos-x', roleId: 'role-Admin' },
    ],
  ])(
    'create with Admin via %s is forbidden and nothing is written',
    async (_n, extra, position) => {
      prisma.position.findUnique.mockResolvedValue(position);
      await expect(
        service.createEmployee({ ...base, ...extra }),
      ).rejects.toThrow(new ForbiddenException(ADMIN_MSG));
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.employee.create).not.toHaveBeenCalled();
    },
  );

  it('the role name check is case-insensitive', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    prisma.role.findUnique.mockResolvedValue({ id: 'r', name: 'ADMIN' });
    await expect(
      service.createEmployee({ ...base, roleId: 'r' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create with CEO is allowed', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    await service.createEmployee({ ...base, roleName: 'CEO' });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ roleId: 'role-CEO' }) as unknown,
    });
  });

  it.each([
    ['roleName', { roleName: 'Admin' }],
    ['roleId', { roleId: 'role-Admin' }],
  ])(
    'promoting an employee to Admin via %s is forbidden; user and employee rows untouched',
    async (_n, dto) => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        userId: 'u-1',
        positionId: 'pos-dev',
      });
      await expect(
        service.updateEmployee('emp-1', dto as never),
      ).rejects.toThrow(ADMIN_MSG);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.employee.update).not.toHaveBeenCalled();
    },
  );

  it('moving an employee to a position whose role is Admin is forbidden', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      userId: 'u-1',
      positionId: 'pos-dev',
    });
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-x',
      roleId: 'role-Admin',
    });
    await expect(
      service.updateEmployee('emp-1', { positionId: 'pos-x' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('promoting an employee to CEO is allowed', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      userId: 'u-1',
      positionId: 'pos-dev',
    });
    await service.updateEmployee('emp-1', { roleName: 'CEO' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        roleId: 'role-CEO',
        tokenVersion: { increment: 1 },
        refreshToken: null,
      },
    });
  });
});

describe('HrEmployeeService.createEmployee', () => {
  it('duplicate e-mail is refused and nothing is created', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-old' });
    await expect(service.createEmployee(base as never)).rejects.toThrow(
      new BadRequestException('Email already in use'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('the position’s role wins over the roleId sent by the client', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-dev',
      roleId: 'role-Manager',
    });
    await service.createEmployee({ ...base, roleId: 'role-Admin' });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ roleId: 'role-Manager' }) as unknown,
    });
  });

  it('without a position: falls back to roleName, then to the Employee role', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    await service.createEmployee({ ...base, roleName: 'HR' });
    expect(prisma.user.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ roleId: 'role-HR' }) as unknown,
    });

    await service.createEmployee(base);
    expect(prisma.user.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ roleId: 'role-Employee' }) as unknown,
    });
  });

  it.each([
    ['Leader', 'Software Development Department', 'Manager'],
    ['Project Manager', 'Project Department', 'Employee'],
    ['HR Office', 'Human Resource Department', 'HR'],
    ['Programmer', 'Software Development Department', 'Employee'],
  ])(
    'with a position, the position decides: %s in %s → %s (whatever roleName says)',
    async (name, dept, role) => {
      prisma.position.findUnique.mockResolvedValue({
        id: 'pos-x',
        name,
        roleId: null,
        department: { name: dept },
      });
      await service.createEmployee({ ...base, roleName: 'Manager' });
      expect(prisma.user.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ roleId: `role-${role}` }) as unknown,
      });
    },
  );

  it('no role can be resolved at all → refused', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue(null);
    await expect(service.createEmployee(base as never)).rejects.toThrow(
      'No default role found',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates user + employee in one transaction, hashes the password, and opens a balance per leave type for this year', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    const out = await service.createEmployee({
      ...base,
      password: 'Secret-1',
      employeeCode: 'E100',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const { data } = (prisma.user.create.mock.calls as unknown[][])[0][0] as {
      data: { passwordHash: string };
    };
    await expect(bcrypt.compare('Secret-1', data.passwordHash)).resolves.toBe(
      true,
    );
    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u-new',
        employeeCode: 'E100',
        departmentId: 'dept-dev',
        gender: 'Unspecified',
      }) as unknown,
    });
    expect(
      (prisma.leaveBalance.create.mock.calls as unknown[][]).map(
        (c) => (c[0] as { data: unknown }).data,
      ),
    ).toEqual([
      {
        employeeId: 'emp-new',
        leaveTypeId: 'lt-sick',
        year: YEAR,
        totalDays: 30,
        usedDays: 0,
        remainingDays: 30,
      },
      {
        employeeId: 'emp-new',
        leaveTypeId: 'lt-vac',
        year: YEAR,
        totalDays: 6,
        usedDays: 0,
        remainingDays: 6,
      },
    ]);
    expect(out.id).toBe('emp-new');
  });

  it('a failure inside the transaction propagates (the transaction rolls back user + employee together)', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    prisma.employee.create.mockRejectedValue(new Error('unique employeeCode'));
    await expect(service.createEmployee(base as never)).rejects.toThrow(
      'unique employeeCode',
    );
    expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
  });
});

describe('HrEmployeeService.updateEmployee / status / delete', () => {
  it('unknown employee → NotFound on update, status change and delete', async () => {
    prisma.employee.findUnique.mockResolvedValue(null);
    await expect(service.updateEmployee('x', {})).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.updateEmployeeStatus('x', false)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.deleteEmployee('x')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('moving to a new position takes that position’s role', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      userId: 'u-1',
      positionId: 'pos-dev',
    });
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-lead',
      roleId: 'role-Manager',
    });
    await service.updateEmployee('emp-1', { positionId: 'pos-lead' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        roleId: 'role-Manager',
        tokenVersion: { increment: 1 },
        refreshToken: null,
      },
    });
    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emp-1' },
        data: expect.objectContaining({ positionId: 'pos-lead' }) as unknown,
      }),
    );
  });

  it('a pure profile edit does not touch the user row', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      userId: 'u-1',
      positionId: 'pos-dev',
    });
    await service.updateEmployee('emp-1', { phone: '0800000000' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each([
    [false, false],
    ['false', false],
    [true, true],
    ['true', true],
  ])(
    'status %p is stored as isActive=%p; disabling also revokes the refresh token',
    async (input, active) => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        userId: 'u-1',
      });
      await expect(
        service.updateEmployeeStatus('emp-1', input as never),
      ).resolves.toEqual({
        success: true,
        isActive: active,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: active
          ? { isActive: true }
          : { isActive: false, refreshToken: null },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: active ? 'ENABLE_USER' : 'DISABLE_USER',
          entityId: 'u-1',
        }) as unknown,
      });
    },
  );

  it('an audit-log failure does not undo the status change', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      userId: 'u-1',
    });
    prisma.auditLog.create.mockRejectedValue(new Error('db'));
    await expect(service.updateEmployeeStatus('emp-1', false)).resolves.toEqual(
      {
        success: true,
        isActive: false,
      },
    );
  });

  it('delete removes the employee and its user together', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      userId: 'u-1',
    });
    await service.deleteEmployee('emp-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.employee.delete).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
    });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u-1' } });
  });
});

describe('HrEmployeeService leave balances', () => {
  const bal = { id: 'b-1', totalDays: 10, usedDays: 4, remainingDays: 6 };

  it.each([
    [{ remainingDays: 0 }, { totalDays: 10, remainingDays: 0, usedDays: 10 }],
    [{ remainingDays: 10 }, { totalDays: 10, remainingDays: 10, usedDays: 0 }],
    [{ totalDays: 12 }, { totalDays: 12, remainingDays: 6, usedDays: 6 }],
  ])('manual edit %p keeps used = total − remaining', async (dto, data) => {
    prisma.leaveBalance.findUnique.mockResolvedValue(bal);
    await service.updateLeaveBalance('b-1', dto);
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      data,
    });
  });

  it.each([
    [{ remainingDays: -1 }],
    [{ remainingDays: 11 }],
    [{ totalDays: 5 }],
  ])('out-of-range edit %p is refused and nothing is written', async (dto) => {
    prisma.leaveBalance.findUnique.mockResolvedValue(bal);
    await expect(
      service.updateLeaveBalance('b-1', dto as never),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('unknown balance id → NotFound', async () => {
    prisma.leaveBalance.findUnique.mockResolvedValue(null);
    await expect(service.updateLeaveBalance('x', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('reset clears used days for the current year only', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      leaveBalances: [
        { id: 'b-now', year: YEAR, totalDays: 30, usedDays: 5 },
        { id: 'b-old', year: YEAR - 1, totalDays: 30, usedDays: 9 },
      ],
    });
    await service.resetLeaveBalances('emp-1');
    expect(prisma.leaveBalance.update).toHaveBeenCalledTimes(1);
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'b-now' },
      data: { usedDays: 0, remainingDays: 30 },
    });
  });

  it('initialize creates missing rows and carries vacation over, capped at 12 days', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      leaveBalances: [
        {
          id: 'b-vac-prev',
          year: YEAR - 1,
          leaveTypeId: 'lt-vac',
          remainingDays: 9,
        },
      ],
    });
    prisma.leaveBalance.create.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve(data),
    );
    const out = await service.initializeLeaveBalances('emp-1');
    expect(out).toEqual({ success: true, initialized: 2, updated: 0 });
    expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leaveTypeId: 'lt-vac',
        totalDays: 12,
        remainingDays: 12,
      }) as unknown,
    });
    expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leaveTypeId: 'lt-sick',
        totalDays: 30,
      }) as unknown,
    });
  });

  it('initialize repairs a negative used-days row without inventing new usage', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      leaveBalances: [
        {
          id: 'b-s',
          year: YEAR,
          leaveTypeId: 'lt-sick',
          totalDays: 30,
          usedDays: -2,
        },
        {
          id: 'b-v',
          year: YEAR,
          leaveTypeId: 'lt-vac',
          totalDays: 6,
          usedDays: 1,
        },
      ],
    });
    const out = await service.initializeLeaveBalances('emp-1');
    expect(out).toEqual({ success: true, initialized: 0, updated: 1 });
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'b-s' },
      data: { totalDays: 30, usedDays: 0, remainingDays: 30 },
    });
  });
});

describe('Business rule — HR cannot edit, suspend or delete an Admin account', () => {
  const MSG =
    'ฝ่ายบุคคลไม่สามารถแก้ไข ระงับ หรือลบบัญชีผู้ดูแลระบบ (Admin) ได้';
  beforeEach(() => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-admin',
      userId: 'u-admin',
      positionId: null,
    });
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id?: string } }) =>
        Promise.resolve(
          where.id === 'u-admin'
            ? { id: 'u-admin', role: { name: 'Admin' } }
            : null,
        ),
    );
  });

  it('editing is forbidden and nothing is written', async () => {
    await expect(
      service.updateEmployee('emp-admin', { firstName: 'x' }),
    ).rejects.toThrow(new ForbiddenException(MSG));
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'changing the status (isActive=%p) is forbidden; no update, no audit entry',
    async (active) => {
      await expect(
        service.updateEmployeeStatus('emp-admin', active),
      ).rejects.toThrow(MSG);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('deleting is forbidden and nothing is removed', async () => {
    await expect(service.deleteEmployee('emp-admin')).rejects.toThrow(MSG);
    expect(prisma.employee.delete).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('a CEO account can still be edited and suspended by HR', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-ceo',
      userId: 'u-ceo',
      positionId: null,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-ceo',
      role: { name: 'CEO' },
    });
    await service.updateEmployee('emp-ceo', { phone: '0800000000' });
    await expect(
      service.updateEmployeeStatus('emp-ceo', false),
    ).resolves.toEqual({ success: true, isActive: false });
  });
});

describe('Business rule — default password for a new employee', () => {
  it('when HR leaves the password empty the account gets "password123" (stored as a hash only)', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    await service.createEmployee(base);
    const { data } = (prisma.user.create.mock.calls as unknown[][])[0][0] as {
      data: { passwordHash: string };
    };
    expect(data.passwordHash).not.toBe('password123');
    await expect(
      bcrypt.compare('password123', data.passwordHash),
    ).resolves.toBe(true);
  });
});

describe('Business rule — a role change signs the user out; no change, no sign-out', () => {
  beforeEach(() => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      userId: 'u-1',
      positionId: 'pos-dev',
    });
  });

  it('role actually changes → roleId set, tokenVersion bumped, refresh token cleared', async () => {
    prisma.user.findUnique.mockResolvedValue({ roleId: 'role-Employee' });
    await service.updateEmployee('emp-1', { roleName: 'Manager' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        roleId: 'role-Manager',
        tokenVersion: { increment: 1 },
        refreshToken: null,
      },
    });
  });

  it('same role saved again → the user row is not touched (nobody is signed out)', async () => {
    prisma.user.findUnique.mockResolvedValue({ roleId: 'role-Manager' });
    await service.updateEmployee('emp-1', { roleName: 'Manager' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('an e-mail change without a role change does not sign the user out', async () => {
    prisma.user.findUnique.mockResolvedValue({ roleId: 'role-Manager' });
    await service.updateEmployee('emp-1', {
      roleName: 'Manager',
      email: 'new@nid.test',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { email: 'new@nid.test' },
    });
  });
});

describe('roleForPosition (same rule as the "add employee" page)', () => {
  it.each([
    ['Leader', 'Software Development Department', 'Employee', 'Manager'],
    ['Project Manager', 'Project Department', 'Employee', 'Employee'], // only Leader is a department head
    ['Programmer', 'Software Development Department', 'Manager', 'Employee'],
    ['Leader', 'Human Resource Department', 'Employee', 'HR'],
    ['HR Office', 'Human Resource Department', 'Employee', 'HR'],
    ['Leader', 'Project Department', 'CEO', 'CEO'],
    ['Programmer', 'Software Development Department', 'CEO', 'CEO'],
    ['Leader', 'Project Department', 'Admin', 'Admin'],
  ])('%s in %s (currently %s) → %s', (pos, dept, current, expected) => {
    expect(roleForPosition(pos, dept, current)).toBe(expected);
  });
});

describe('Business rule — changing the position changes the role (and signs the user out)', () => {
  /** The user's current role; the position and its department. */
  function setup(
    currentRole: string,
    position: { name: string; dept: string; roleId?: string | null },
  ) {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      userId: 'u-1',
      positionId: 'pos-old',
    });
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-new',
      name: position.name,
      roleId: position.roleId ?? null,
      department: { name: position.dept },
    });
    prisma.user.findUnique.mockImplementation(
      ({ select }: { select?: Record<string, unknown> }) =>
        Promise.resolve(
          select?.role
            ? { role: { name: currentRole } }
            : { roleId: `role-${currentRole}` },
        ),
    );
  }
  const signedOutAs = (role: string) => ({
    where: { id: 'u-1' },
    data: {
      roleId: `role-${role}`,
      tokenVersion: { increment: 1 },
      refreshToken: null,
    },
  });

  it('Programmer → Leader: becomes Manager (approval rights, manager menus) and must log in again', async () => {
    setup('Employee', {
      name: 'Leader',
      dept: 'Software Development Department',
    });
    // the edit form still sends the OLD role name — the position wins
    await service.updateEmployee('emp-1', {
      positionId: 'pos-new',
      roleName: 'Employee',
    });
    expect(prisma.user.update).toHaveBeenCalledWith(signedOutAs('Manager'));
  });

  it('Leader → Programmer: loses Manager (no more approving the department)', async () => {
    setup('Manager', {
      name: 'Programmer',
      dept: 'Software Development Department',
    });
    await service.updateEmployee('emp-1', {
      positionId: 'pos-new',
      roleName: 'Manager',
    });
    expect(prisma.user.update).toHaveBeenCalledWith(signedOutAs('Employee'));
  });

  it('into the HR department → HR (an HR Leader heads HR)', async () => {
    setup('Employee', { name: 'Leader', dept: 'Human Resource Department' });
    await service.updateEmployee('emp-1', { positionId: 'pos-new' });
    expect(prisma.user.update).toHaveBeenCalledWith(signedOutAs('HR'));
  });

  it('a CEO who changes position stays CEO — nothing written, nobody signed out', async () => {
    setup('CEO', { name: 'Programmer', dept: 'Project Department' });
    await service.updateEmployee('emp-1', {
      positionId: 'pos-new',
      roleName: 'CEO',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a move that keeps the same role (Programmer → Senior Programmer) signs nobody out', async () => {
    setup('Employee', {
      name: 'SA & Senior Programmer',
      dept: 'Software Development Department',
    });
    await service.updateEmployee('emp-1', {
      positionId: 'pos-new',
      roleName: 'Employee',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a position with its own role still decides first', async () => {
    setup('Employee', {
      name: 'Coordinator',
      dept: 'Project Department',
      roleId: 'role-Manager',
    });
    await service.updateEmployee('emp-1', { positionId: 'pos-new' });
    expect(prisma.user.update).toHaveBeenCalledWith(signedOutAs('Manager'));
  });

  it('editing other fields without moving position keeps the role', async () => {
    setup('Manager', {
      name: 'Programmer',
      dept: 'Software Development Department',
    });
    await service.updateEmployee('emp-1', {
      phone: '0800000000',
      roleName: 'Manager',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.position.findUnique).not.toHaveBeenCalled();
  });
});
