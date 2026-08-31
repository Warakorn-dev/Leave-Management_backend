import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {
  PaginationDto,
  UpdateSettingsDto,
  UpdateUserRoleDto,
  ToggleUserStatusDto,
} from './dto/admin.dto';

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

    const where: any = {};
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
      items: users,
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
      data: { refreshToken: null },
    });
    return { message: 'User forced logout successfully' };
  }

  async toggleStatus(userId: string, dto: ToggleUserStatusDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: dto.isActive,
        // If deactivating, also logout
        ...(dto.isActive === false ? { refreshToken: null } : {}),
      },
    });
    return { message: `User ${dto.isActive ? 'activated' : 'deactivated'}` };
  }

  async resetPassword(userId: string) {
    // Generate simple random password
    const tempPassword = Math.random().toString(36).slice(-8);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        refreshToken: null,
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

  async updateRole(userId: string, dto: UpdateUserRoleDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { roleId: dto.roleId },
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
        include: { user: { select: { email: true, username: true } } },
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
    return this.prisma.adminSetting.findMany();
  }

  async updateSettings(dto: UpdateSettingsDto) {
    for (const setting of dto.settings) {
      await this.prisma.adminSetting.upsert({
        where: { key: setting.key },
        update: { value: setting.value },
        create: { key: setting.key, value: setting.value },
      });
    }
    return { message: 'Settings updated successfully' };
  }

  async getSystemHealth() {
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
      include: { user: { select: { email: true, username: true } } },
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
      log.user ? log.user.email || log.user.username : 'System',
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
