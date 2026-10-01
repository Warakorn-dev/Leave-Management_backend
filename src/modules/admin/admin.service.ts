import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { roleChangeSignOut } from '../../common/role-change';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import {
  PaginationDto,
  UpdateSettingsDto,
  UpdateUserRoleDto,
  ToggleUserStatusDto,
} from './dto/admin.dto';

const ADMIN_ROLE = 'Admin';
const LAST_ADMIN_MESSAGE =
  'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน จึงไม่สามารถลดสิทธิ์หรือระงับผู้ดูแลระบบคนสุดท้ายได้';

// No look-alike characters (0/O, 1/l/I) so the admin can read it out safely.
const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 10;

/**
 * Temporary password for an admin reset, from a cryptographically secure
 * generator (Math.random is predictable and could even return fewer than 8
 * characters). 10 chars from 56 symbols ≈ 58 bits.
 */
export function generateTempPassword(): string {
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const totalUsers = await this.prisma.user.count();
    const activeUsers = await this.prisma.user.count({
      where: { isActive: true },
    });

    // Check CAPTCHAs in last 24h
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const failedLogins = await this.prisma.auditLog.count({
      where: {
        action: 'LOGIN_FAILED',
        createdAt: { gte: yesterday },
      },
    });

    const recentLogs = await this.prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, username: true } } },
    });

    const usersByRole = await this.prisma.role.findMany({
      include: {
        _count: {
          select: { user: true },
        },
      },
    });

    return {
      totalUsers,
      activeUsers,
      failedLogins24h: failedLogins,
      recentLogs,
      usersByRole: usersByRole.map((r) => ({
        role: r.name,
        count: r._count.user,
      })),
    };
  }

  async getUsers(query: PaginationDto) {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '10', 10);
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    if (query.search) {
      where.OR = [
        { email: { contains: query.search } },
        { username: { contains: query.search } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          username: true,
          isActive: true,
          failedLoginAttempts: true,
          lockedUntil: true,
          lastLoginAt: true,
          lastLoginIp: true,
          refreshToken: true,
          role: { select: { id: true, name: true } },
          employee: {
            select: {
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map(({ refreshToken, ...u }) => ({
        ...u,
        isLoggedIn: !!refreshToken,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAllUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        role: { select: { name: true } },
        employee: {
          select: {
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            position: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async forceLogout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, tokenVersion: { increment: 1 } },
    });
    return { message: 'User forced logout successfully' };
  }

  /**
   * Business rule (2026-09-24): the system always keeps at least one active
   * Admin. Throws if `userId` is the last active Admin (about to be demoted
   * or suspended).
   */
  private async assertNotLastActiveAdmin(userId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, role: { select: { name: true } } },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.role?.name !== ADMIN_ROLE || target.isActive === false) return;
    const activeAdmins = await this.prisma.user.count({
      where: { isActive: true, role: { name: ADMIN_ROLE } },
    });
    if (activeAdmins <= 1) {
      throw new BadRequestException(LAST_ADMIN_MESSAGE);
    }
  }

  async toggleStatus(
    actorId: string,
    userId: string,
    dto: ToggleUserStatusDto,
  ) {
    if (dto.isActive === false) {
      if (actorId === userId) {
        throw new BadRequestException('ไม่สามารถระงับบัญชีของตัวเองได้');
      }
      await this.assertNotLastActiveAdmin(userId);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: dto.isActive,
        ...(dto.isActive ? { lockedUntil: null, failedLoginAttempts: 0 } : {}),
        // If deactivating, also logout
        ...(dto.isActive === false
          ? { refreshToken: null, tokenVersion: { increment: 1 } }
          : {}),
      },
    });
    return { message: `User ${dto.isActive ? 'activated' : 'deactivated'}` };
  }

  async resetPassword(userId: string) {
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        refreshToken: null,
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    // In a real app, send an email here instead of returning it.
    // We return it for the admin to copy-paste.
    return {
      message: 'Password reset successfully',
      tempPassword,
    };
  }

  async updateRole(actorId: string, userId: string, dto: UpdateUserRoleDto) {
    if (actorId === userId) {
      throw new BadRequestException('ไม่สามารถเปลี่ยนสิทธิ์ของบัญชีตัวเองได้');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { roleId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.roleId === dto.roleId) {
      return { message: 'Role updated successfully' };
    }
    const newRole = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
      select: { name: true },
    });
    if (!newRole) throw new BadRequestException('ไม่พบสิทธิ์ที่เลือก');
    if (newRole.name !== ADMIN_ROLE) {
      await this.assertNotLastActiveAdmin(userId);
    }
    // Business rule (2026-09-24): a role change signs the user out everywhere,
    // so their next login shows the menus and pages of the new role (the UI
    // keeps the role from login time; permissions already follow the DB).
    await this.prisma.user.update({
      where: { id: userId },
      data: roleChangeSignOut(dto.roleId),
    });
    return { message: 'Role updated successfully' };
  }

  async getAuditLogs(query: PaginationDto) {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              email: true,
              username: true,
              employee: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.auditLog.count(),
    ]);

    return {
      items: logs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSettings() {
    // Ensure default settings exist in DB
    const defaults = [
      { key: 'MAX_FAILED_LOGINS', value: '5' },
      { key: 'LOCKOUT_DURATION_MINUTES', value: '15' },
      { key: 'JWT_EXPIRATION', value: '15m' },
      { key: 'IDLE_TIMEOUT_MINUTES', value: '60' },
    ];
    for (const def of defaults) {
      await this.prisma.adminSetting.upsert({
        where: { key: def.key },
        update: {},
        create: { key: def.key, value: def.value },
      });
    }
    const settings = await this.prisma.adminSetting.findMany();
    return { data: settings };
  }

  async updateSettings(dto: UpdateSettingsDto) {
    for (const setting of dto.settings) {
      await this.prisma.adminSetting.upsert({
        where: { key: setting.key },
        update: { value: setting.value },
        create: { key: setting.key, value: setting.value },
      });
    }
    const updated = await this.prisma.adminSetting.findMany();
    return { message: 'Settings updated successfully', data: updated };
  }

  getSystemHealth() {
    const memory = process.memoryUsage();
    return {
      status: 'OK',
      uptime: process.uptime(),
      memory: {
        rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`,
      },
    };
  }

  async exportAuditLogs() {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            email: true,
            username: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    // Create CSV content
    const header = [
      'ID',
      'User',
      'Action',
      'Entity',
      'Entity ID',
      'IP Address',
      'Created At',
      'Details',
    ];
    const rows = logs.map((log) => [
      log.id,
      log.user
        ? log.user.employee
          ? `${log.user.employee.firstName} ${log.user.employee.lastName}`
          : log.user.username || log.user.email
        : 'System',
      log.action,
      log.entity,
      log.entityId || '-',
      log.ipAddress || '-',
      log.createdAt.toISOString(),
      (log.details || '').replace(/"/g, '""'), // Escape quotes for CSV
    ]);

    const csvContent = [
      header.join(','),
      ...rows.map((r) => r.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  async getCaptchaStats() {
    const total = await this.prisma.captcha.count();
    const used = await this.prisma.captcha.count({ where: { isUsed: true } });
    const expired = await this.prisma.captcha.count({
      where: { expiredAt: { lt: new Date() }, isUsed: false },
    });
    const active = await this.prisma.captcha.count({
      where: { expiredAt: { gt: new Date() }, isUsed: false },
    });

    return { total, used, expired, active };
  }

  async purgeCaptcha() {
    const result = await this.prisma.captcha.deleteMany({
      where: {
        OR: [{ isUsed: true }, { expiredAt: { lt: new Date() } }],
      },
    });
    return { message: `Purged ${result.count} CAPTCHA records` };
  }

  async getRoles() {
    const roles = await this.prisma.role.findMany({
      include: {
        _count: {
          select: { user: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      userCount: r._count.user,
      createdAt: r.createdAt,
    }));
  }
}
