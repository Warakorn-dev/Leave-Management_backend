/// <reference types="jest" />
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HrOrgService } from './hr-org.service';

function createPrisma() {
  const prisma = {
    role: { findUnique: jest.fn(), findMany: jest.fn() },
    position: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    employee: { updateMany: jest.fn(), findMany: jest.fn() },
    user: { update: jest.fn() },
    leaveType: { findMany: jest.fn(), create: jest.fn() },
    publicHoliday: { create: jest.fn(), update: jest.fn() },
  };
  return Object.assign(prisma, {
    $transaction: jest.fn((fn: (tx: typeof prisma) => unknown) =>
      Promise.resolve(fn(prisma)),
    ),
  });
}
let prisma: ReturnType<typeof createPrisma>;
let service: HrOrgService;
beforeEach(() => {
  prisma = createPrisma();
  service = new HrOrgService(prisma as never);
});

const MANAGER_ROLE = { id: 'role-mgr', name: 'Manager' };
const MSG =
  'แผนกนี้มีตำแหน่งหัวหน้าแผนก (Manager) อยู่แล้ว ไม่สามารถเพิ่มได้อีก';

describe('HrOrgService positions — one Manager position per department', () => {
  it('a second Manager position in the same department is refused', async () => {
    prisma.role.findUnique.mockResolvedValue(MANAGER_ROLE);
    prisma.position.findFirst.mockResolvedValue({ id: 'pos-existing' });
    await expect(
      service.createPosition({
        name: 'Lead',
        departmentId: 'd-1',
        roleId: 'role-mgr',
      }),
    ).rejects.toThrow(MSG);
    expect(prisma.position.findFirst).toHaveBeenCalledWith({
      where: { departmentId: 'd-1', role: { name: 'Manager' } },
    });
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  it('the first Manager position, or a non-manager role, is created', async () => {
    prisma.role.findUnique.mockResolvedValue(MANAGER_ROLE);
    prisma.position.findFirst.mockResolvedValue(null);
    await service.createPosition({
      name: 'Lead',
      departmentId: 'd-1',
      roleId: 'role-mgr',
    });
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-emp',
      name: 'Employee',
    });
    await service.createPosition({
      name: 'Dev',
      departmentId: 'd-1',
      roleId: 'role-emp',
    });
    expect(prisma.position.create).toHaveBeenCalledTimes(2);
  });

  it('editing a position ignores itself when checking for another Manager position', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.role.findUnique.mockResolvedValue(MANAGER_ROLE);
    prisma.position.findFirst.mockResolvedValue(null);
    prisma.position.update.mockResolvedValue({ id: 'pos-1' });
    prisma.employee.findMany.mockResolvedValue([]);
    await service.updatePosition('pos-1', { roleId: 'role-mgr' });
    expect(prisma.position.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: 'pos-1' },
        departmentId: 'd-1',
        role: { name: 'Manager' },
      },
    });
  });

  it('editing into a department that already has a Manager position is refused, nothing written', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.role.findUnique.mockResolvedValue(MANAGER_ROLE);
    prisma.position.findFirst.mockResolvedValue({ id: 'pos-other' });
    await expect(
      service.updatePosition('pos-1', {
        roleId: 'role-mgr',
        departmentId: 'd-2',
      }),
    ).rejects.toThrow(MSG);
    expect(prisma.position.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('unknown position → NotFound', async () => {
    prisma.position.findUnique.mockResolvedValue(null);
    await expect(service.updatePosition('x', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('changing a position’s role and department cascades to everyone holding it', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.role.findUnique.mockResolvedValue({ id: 'role-hr', name: 'HR' });
    prisma.position.update.mockResolvedValue({ id: 'pos-1' });
    prisma.employee.findMany.mockResolvedValue([
      { userId: 'u-1' },
      { userId: 'u-2' },
    ]);
    await service.updatePosition('pos-1', {
      roleId: 'role-hr',
      departmentId: 'd-2',
    });

    // (Admin holders are excluded from cascades — HR may not edit Admin accounts)
    expect(prisma.employee.updateMany).toHaveBeenCalledWith({
      where: {
        positionId: 'pos-1',
        user: { role: { name: { not: 'Admin' } } },
      },
      data: { departmentId: 'd-2' },
    });
    expect(prisma.user.update.mock.calls).toEqual([
      [
        {
          where: { id: 'u-1' },
          data: {
            roleId: 'role-hr',
            tokenVersion: { increment: 1 },
            refreshToken: null,
          },
        },
      ],
      [
        {
          where: { id: 'u-2' },
          data: {
            roleId: 'role-hr',
            tokenVersion: { increment: 1 },
            refreshToken: null,
          },
        },
      ],
    ]);
  });

  it('clearing a position’s role puts its holders back on the Employee role', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.position.update.mockResolvedValue({ id: 'pos-1' });
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-emp',
      name: 'Employee',
    });
    prisma.employee.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    await service.updatePosition('pos-1', { roleId: null } as never);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        roleId: 'role-emp',
        tokenVersion: { increment: 1 },
        refreshToken: null,
      },
    });
  });
});

describe('HrOrgService leave types and holidays', () => {
  it('a new leave type gets the next two-digit code and safe defaults', async () => {
    prisma.leaveType.findMany.mockResolvedValue([
      { code: '01' },
      { code: '09' },
      { code: 'XX' },
    ]);
    await service.createLeaveType({ name: 'ลาใหม่', defaultDays: 5 });
    expect(prisma.leaveType.create).toHaveBeenCalledWith({
      data: {
        code: '10',
        name: 'ลาใหม่',
        defaultDays: 5,
        requiresCertificate: false,
        isSpecial: false,
        advanceNoticeDays: 0,
        minTenureDays: 0,
      },
    });
  });

  it('the first leave type is "01"; code 99 is the maximum', async () => {
    prisma.leaveType.findMany.mockResolvedValue([]);
    await service.createLeaveType({ name: 'a', defaultDays: 1 });
    expect(prisma.leaveType.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: '01' }) as unknown,
    });

    prisma.leaveType.findMany.mockResolvedValue([{ code: '99' }]);
    await expect(
      service.createLeaveType({ name: 'b', defaultDays: 1 }),
    ).rejects.toThrow('รองรับสูงสุด 99 ประเภท');
    expect(prisma.leaveType.create).toHaveBeenCalledTimes(1);
  });

  it('holiday update changes only the fields given', async () => {
    await service.updateHoliday('h-1', { name: 'วันใหม่' });
    expect(prisma.publicHoliday.update).toHaveBeenCalledWith({
      where: { id: 'h-1' },
      data: { name: 'วันใหม่' },
    });
  });
});

describe('Business rule — HR positions can carry CEO but never Admin', () => {
  const ADMIN_MSG = 'ฝ่ายบุคคลไม่สามารถกำหนดสิทธิ์ผู้ดูแลระบบ (Admin) ได้';

  it('creating a position with the Admin role is forbidden', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-admin',
      name: 'Admin',
    });
    await expect(
      service.createPosition({
        name: 'Sys',
        departmentId: 'd-1',
        roleId: 'role-admin',
      }),
    ).rejects.toThrow(new ForbiddenException(ADMIN_MSG));
    expect(prisma.position.create).not.toHaveBeenCalled();
  });

  it('changing a position to Admin is forbidden and nobody holding it is promoted', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-admin',
      name: 'Admin',
    });
    prisma.employee.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    await expect(
      service.updatePosition('pos-1', { roleId: 'role-admin' }),
    ).rejects.toThrow(ADMIN_MSG);
    expect(prisma.position.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a CEO position is allowed and cascades to its holders', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.role.findUnique.mockResolvedValue({ id: 'role-ceo', name: 'CEO' });
    prisma.position.update.mockResolvedValue({ id: 'pos-1' });
    prisma.employee.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    await service.updatePosition('pos-1', { roleId: 'role-ceo' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        roleId: 'role-ceo',
        tokenVersion: { increment: 1 },
        refreshToken: null,
      },
    });
  });

  it('the roles list offered to HR leaves Admin out', async () => {
    prisma.role.findMany.mockResolvedValue([]);
    await service.findAllRoles();
    expect(prisma.role.findMany).toHaveBeenCalledWith({
      where: { name: { not: 'Admin' } },
      orderBy: { name: 'asc' },
    });
  });
});

describe('Business rule — position cascades skip Admin accounts', () => {
  it('role and department cascades only select non-Admin holders', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.role.findUnique.mockResolvedValue({ id: 'role-hr', name: 'HR' });
    prisma.position.update.mockResolvedValue({ id: 'pos-1' });
    prisma.employee.findMany.mockResolvedValue([]);
    await service.updatePosition('pos-1', {
      roleId: 'role-hr',
      departmentId: 'd-2',
    });
    const notAdmin = { user: { role: { name: { not: 'Admin' } } } };
    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { positionId: 'pos-1', ...notAdmin },
      include: { user: { select: { roleId: true } } },
    });
    expect(prisma.employee.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { positionId: 'pos-1', ...notAdmin } }),
    );
  });
});

describe('Business rule — position role cascade signs out only people whose role changes', () => {
  it('holders already on the new role are skipped; the others are updated and signed out', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.role.findUnique.mockResolvedValue({ id: 'role-hr', name: 'HR' });
    prisma.position.update.mockResolvedValue({ id: 'pos-1' });
    prisma.employee.findMany.mockResolvedValue([
      { userId: 'u-same', user: { roleId: 'role-hr' } },
      { userId: 'u-moved', user: { roleId: 'role-emp' } },
    ]);
    await service.updatePosition('pos-1', { roleId: 'role-hr' });
    expect(prisma.user.update.mock.calls).toEqual([
      [
        {
          where: { id: 'u-moved' },
          data: {
            roleId: 'role-hr',
            tokenVersion: { increment: 1 },
            refreshToken: null,
          },
        },
      ],
    ]);
  });

  it('editing only the name of a position signs nobody out', async () => {
    prisma.position.findUnique.mockResolvedValue({
      id: 'pos-1',
      departmentId: 'd-1',
    });
    prisma.position.update.mockResolvedValue({ id: 'pos-1' });
    await service.updatePosition('pos-1', { name: 'Senior Dev' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
