import { Test, TestingModule } from '@nestjs/testing';
import { AdminService, generateTempPassword } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('AdminService account actions', () => {
  let prisma: {
    user: { update: jest.Mock; findUnique: jest.Mock; count: jest.Mock };
    role: { findUnique: jest.Mock };
  };
  let admin: AdminService;
  beforeEach(() => {
    prisma = {
      user: {
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ roleId: 'role-Employee' }),
        count: jest.fn().mockResolvedValue(1),
      },
      role: { findUnique: jest.fn().mockResolvedValue({ name: 'HR' }) },
    };
    admin = new AdminService(prisma as never);
  });

  it('force logout revokes the refresh token and bumps tokenVersion', async () => {
    await admin.forceLogout('u-1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { refreshToken: null, tokenVersion: { increment: 1 } },
    });
  });

  it('deactivating also logs the user out everywhere', async () => {
    await expect(
      admin.toggleStatus('u-admin', 'u-1', { isActive: false }),
    ).resolves.toEqual({
      message: 'User deactivated',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        isActive: false,
        refreshToken: null,
        tokenVersion: { increment: 1 },
      },
    });
  });

  it('activating clears a login lockout and the failed-attempt counter', async () => {
    await admin.toggleStatus('u-admin', 'u-1', { isActive: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { isActive: true, lockedUntil: null, failedLoginAttempts: 0 },
    });
  });

  it('password reset stores only a hash of the temporary password and ends every session', async () => {
    const out = await admin.resetPassword('u-1');
    expect(out.tempPassword).toHaveLength(10); // was 8 (Math.random) until 2026-09-24
    const { data } = (prisma.user.update.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown> & { passwordHash: string };
    };
    expect(data.passwordHash).not.toBe(out.tempPassword);
    await expect(
      bcrypt.compare(out.tempPassword, data.passwordHash),
    ).resolves.toBe(true);
    expect(data).toEqual(
      expect.objectContaining({
        refreshToken: null,
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      }),
    );
  });

  it('role change writes the new roleId for that user only — and signs them out (2026-09-24 rule)', async () => {
    await admin.updateRole('u-admin', 'u-1', { roleId: 'role-HR' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        roleId: 'role-HR',
        tokenVersion: { increment: 1 },
        refreshToken: null,
      },
    });
  });

  it('saving the same role again changes nothing and signs nobody out', async () => {
    await admin.updateRole('u-admin', 'u-1', { roleId: 'role-Employee' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('unknown user → NotFound, nothing written', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      admin.updateRole('u-admin', 'ghost', { roleId: 'role-HR' }),
    ).rejects.toThrow('User not found');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('generateTempPassword (secure random)', () => {
  it('10 characters, no look-alike characters (0 O 1 l I)', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/);
    }
  });

  it('does not use Math.random', () => {
    const spy = jest.spyOn(Math, 'random');
    generateTempPassword();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not repeat across 1,000 resets', () => {
    const seen = new Set(Array.from({ length: 1000 }, generateTempPassword));
    expect(seen.size).toBe(1000);
  });
});

describe('Business rule — there is always at least one active Admin', () => {
  const SELF_ROLE = 'ไม่สามารถเปลี่ยนสิทธิ์ของบัญชีตัวเองได้';
  const SELF_SUSPEND = 'ไม่สามารถระงับบัญชีของตัวเองได้';
  const LAST =
    'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน จึงไม่สามารถลดสิทธิ์หรือระงับผู้ดูแลระบบคนสุดท้ายได้';

  /** Users by id; `count` answers "how many active Admins". */
  function adminWith(
    users: Record<string, { roleId: string; role: string; isActive: boolean }>,
  ) {
    const prisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => {
          const u = users[where.id];
          return Promise.resolve(
            u
              ? {
                  roleId: u.roleId,
                  isActive: u.isActive,
                  role: { name: u.role },
                }
              : null,
          );
        }),
        count: jest.fn(() =>
          Promise.resolve(
            Object.values(users).filter((u) => u.role === 'Admin' && u.isActive)
              .length,
          ),
        ),
        update: jest.fn(),
      },
      role: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ name: where.id.replace(/^role-/, '') }),
        ),
      },
    };
    return { prisma, admin: new AdminService(prisma as never) };
  }
  const A = (isActive = true) => ({
    roleId: 'role-Admin',
    role: 'Admin',
    isActive,
  });
  const E = () => ({
    roleId: 'role-Employee',
    role: 'Employee',
    isActive: true,
  });

  it('an admin cannot change their OWN role (nothing is read or written)', async () => {
    const { prisma, admin } = adminWith({ me: A(), other: A() });
    await expect(
      admin.updateRole('me', 'me', { roleId: 'role-Employee' }),
    ).rejects.toThrow(SELF_ROLE);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('an admin cannot suspend their OWN account', async () => {
    const { prisma, admin } = adminWith({ me: A(), other: A() });
    await expect(
      admin.toggleStatus('me', 'me', { isActive: false }),
    ).rejects.toThrow(SELF_SUSPEND);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('the LAST active Admin cannot be demoted', async () => {
    const { prisma, admin } = adminWith({
      me: A(),
      last: A(false),
      other: A(),
    });
    // "other" is the only other active admin; demoting it leaves "me" → allowed
    await admin.updateRole('me', 'other', { roleId: 'role-HR' });
    expect(prisma.user.update).toHaveBeenCalledTimes(1);

    const only = adminWith({ me: E(), boss: A() }); // e.g. called by a seeded service account
    await expect(
      only.admin.updateRole('me', 'boss', { roleId: 'role-HR' }),
    ).rejects.toThrow(LAST);
    expect(only.prisma.user.update).not.toHaveBeenCalled();
  });

  it('the LAST active Admin cannot be suspended', async () => {
    const { prisma, admin } = adminWith({ me: E(), boss: A() });
    await expect(
      admin.toggleStatus('me', 'boss', { isActive: false }),
    ).rejects.toThrow(LAST);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('with two active Admins, one may demote or suspend the other', async () => {
    const r = adminWith({ me: A(), other: A() });
    await r.admin.updateRole('me', 'other', { roleId: 'role-HR' });
    expect(r.prisma.user.update).toHaveBeenCalledTimes(1);

    const s = adminWith({ me: A(), other: A() });
    await s.admin.toggleStatus('me', 'other', { isActive: false });
    expect(s.prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('promoting someone TO Admin, re-activating, or changing non-admins is never blocked', async () => {
    const { prisma, admin } = adminWith({ me: A(), emp: E() });
    await admin.updateRole('me', 'emp', { roleId: 'role-Admin' });
    await admin.toggleStatus('me', 'emp', { isActive: false });
    await admin.toggleStatus('me', 'emp', { isActive: true });
    expect(prisma.user.update).toHaveBeenCalledTimes(3);
  });

  it('an unknown role id is refused', async () => {
    const { prisma, admin } = adminWith({ me: A(), emp: E() });
    prisma.role.findUnique.mockResolvedValueOnce(null as never);
    await expect(
      admin.updateRole('me', 'emp', { roleId: 'role-Nope' }),
    ).rejects.toThrow('ไม่พบสิทธิ์ที่เลือก');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
