import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreatePositionDto,
  UpdatePositionDto,
  CreateLeaveTypeDto,
  UpdateLeaveTypeDto,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  CreatePublicHolidayDto,
  UpdatePublicHolidayDto,
  UpdateLeaveBalanceDto,
} from './dto/hr.dto';
import * as bcrypt from 'bcrypt';

import { NotificationService } from '../notification/notification.service';

@Injectable()
export class HrService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  // --- Departments ---
  async createDepartment(dto: CreateDepartmentDto) {
    return this.prisma.department.create({ data: dto });
  }

  async findAllDepartments() {
    return this.prisma.department.findMany();
  }

  async updateDepartment(id: string, dto: UpdateDepartmentDto) {
    return this.prisma.department.update({ where: { id }, data: dto });
  }

  async deleteDepartment(id: string) {
    return this.prisma.department.delete({ where: { id } });
  }

  // --- Roles ---
  async findAllRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
    });
    return { success: true, data: roles };
  }

  // --- Positions ---
  async createPosition(dto: CreatePositionDto) {
    if (dto.roleId && dto.departmentId) {
      const role = await this.prisma.role.findUnique({
        where: { id: dto.roleId },
      });
      if (role && role.name.toLowerCase() === 'manager') {
        const existingManager = await this.prisma.position.findFirst({
          where: {
            departmentId: dto.departmentId,
            role: { name: role.name },
          },
        });
        if (existingManager) {
          throw new BadRequestException(
            'แผนกนี้มีตำแหน่งผู้จัดการ (Manager) อยู่แล้ว ไม่สามารถเพิ่มได้อีก',
          );
        }
      }
    }

    return this.prisma.position.create({
      data: {
        name: dto.name,
        code: dto.code,
        departmentId: dto.departmentId,
        roleId: dto.roleId,
      },
    });
  }

  async findAllPositions() {
    return this.prisma.position.findMany({
      include: { department: true, role: true },
    });
  }

  async updatePosition(id: string, dto: UpdatePositionDto) {
    return this.prisma.$transaction(async (prisma) => {
      const existingPos = await prisma.position.findUnique({ where: { id } });
      if (!existingPos) throw new NotFoundException('Position not found');
      const deptId = dto.departmentId || existingPos.departmentId;

      if (dto.roleId && deptId) {
        const role = await prisma.role.findUnique({
          where: { id: dto.roleId },
        });
        if (role && role.name.toLowerCase() === 'manager') {
          const existingManager = await prisma.position.findFirst({
            where: {
              id: { not: id },
              departmentId: deptId,
              role: { name: role.name },
            },
          });
          if (existingManager) {
            throw new BadRequestException(
              'แผนกนี้มีตำแหน่งผู้จัดการ (Manager) อยู่แล้ว ไม่สามารถเพิ่มได้อีก',
            );
          }
        }
      }

      const position = await prisma.position.update({
        where: { id },
        data: {
          name: dto.name,
          code: dto.code,
          departmentId: dto.departmentId,
          roleId: dto.roleId,
        },
      });

      if (dto.departmentId) {
        await prisma.employee.updateMany({
          where: { positionId: id },
          data: { departmentId: dto.departmentId },
        });
      }

      // Cascade role update to all users holding this position
      if (dto.roleId !== undefined) {
        let assignedRoleId = dto.roleId;
        if (assignedRoleId === null) {
          const employeeRole = await prisma.role.findUnique({
            where: { name: 'Employee' },
          });
          if (employeeRole) {
            assignedRoleId = employeeRole.id;
          }
        }

        if (assignedRoleId) {
          const employees = await prisma.employee.findMany({
            where: { positionId: id },
          });
          for (const emp of employees) {
            await prisma.user.update({
              where: { id: emp.userId },
              data: { roleId: assignedRoleId },
            });
          }
        }
      }

      return position;
    });
  }

  async deletePosition(id: string) {
    return this.prisma.position.delete({ where: { id } });
  }

  // --- Leave Types ---
  async createLeaveType(dto: CreateLeaveTypeDto) {
    const leaveTypes = await this.prisma.leaveType.findMany({
      select: { code: true },
    });
    const highestCode = leaveTypes.reduce((highest, leaveType) => {
      const value = Number.parseInt(leaveType.code, 10);
      return Number.isInteger(value) ? Math.max(highest, value) : highest;
    }, 0);

    if (highestCode >= 99) {
      throw new BadRequestException(
        'ไม่สามารถสร้างรหัสประเภทการลาเพิ่มได้ (รองรับสูงสุด 99 ประเภท)',
      );
    }

    return this.prisma.leaveType.create({
      data: {
        code: String(highestCode + 1).padStart(2, '0'),
        name: dto.name,
        defaultDays: dto.defaultDays,
        requiresCertificate: dto.requiresCertificate ?? false,
        isSpecial: dto.isSpecial ?? false,
        advanceNoticeDays: dto.advanceNoticeDays ?? 0,
        minTenureDays: dto.minTenureDays ?? 0,
      },
    });
  }

  async findAllLeaveTypes() {
    return this.prisma.leaveType.findMany({ orderBy: { code: 'asc' } });
  }

  async updateLeaveType(id: string, dto: UpdateLeaveTypeDto) {
    return this.prisma.leaveType.update({
      where: { id },
      data: dto,
    });
  }

  async deleteLeaveType(id: string) {
    return this.prisma.leaveType.delete({ where: { id } });
  }

  // --- Employees ---
  async createEmployee(dto: CreateEmployeeDto) {
    // Check if user email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    let roleId = dto.roleId;

    // Auto-assign role from position if available
    if (dto.positionId) {
      const position = await this.prisma.position.findUnique({
        where: { id: dto.positionId },
      });
      if (position && position.roleId) {
        roleId = position.roleId;
      }
    }

    if (!roleId && dto.roleName) {
      const role = await this.prisma.role.findFirst({
        where: { name: dto.roleName },
      });
      if (role) roleId = role.id;
    }

    if (!roleId) {
      const defaultRole = await this.prisma.role.findFirst({
        where: { name: 'Employee' },
      });
      if (!defaultRole) {
        const userRole = await this.prisma.role.findFirst({
          where: { name: 'User' },
        });
        roleId = userRole?.id;
      } else {
        roleId = defaultRole.id;
      }
      if (!roleId) throw new BadRequestException('No default role found');
    }

    const rawPassword = dto.password || 'password123';
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    // Create user and employee in a transaction
    return this.prisma.$transaction(async (prisma) => {
      const user = await prisma.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          passwordHash,
          roleId,
        },
      });

      const employee = await prisma.employee.create({
        data: {
          userId: user.id,
          employeeCode: dto.employeeCode || null,
          title: dto.title || null,
          firstName: dto.firstName,
          lastName: dto.lastName,
          gender: dto.gender || 'Unspecified',
          phone: dto.phone,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          hireDate: dto.hireDate ? new Date(dto.hireDate) : new Date(),
          firstNameEN: dto.firstNameEN || null,
          lastNameEN: dto.lastNameEN || null,
          idCardNumber: dto.idCardNumber || null,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          idCardAddress: dto.idCardAddress || null,
          currentAddress: dto.currentAddress || null,
        },
      });

      // Initialize leave balances for the current year
      const currentYear = new Date().getFullYear();
      const leaveTypes = await prisma.leaveType.findMany();

      const balancePromises = leaveTypes.map((type) =>
        prisma.leaveBalance.create({
          data: {
            employeeId: employee.id,
            leaveTypeId: type.id,
            year: currentYear,
            totalDays: type.defaultDays,
            usedDays: 0,
            remainingDays: type.defaultDays,
          },
        }),
      );
      await Promise.all(balancePromises);

      return employee;
    });
  }

  async updateEmployee(currentUser: any, id: string, dto: UpdateEmployeeDto) {
    return this.prisma.$transaction(async (prisma) => {
      const employee = await prisma.employee.findUnique({
        where: { id },
        include: { user: { include: { role: true } } },
      });
      if (!employee) throw new NotFoundException('Employee not found');

      const targetRoleName = employee.user?.role?.name?.toLowerCase();
      const currentRole = currentUser?.role?.toLowerCase();

      if (currentRole !== 'ceo' && targetRoleName === 'ceo') {
        throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขข้อมูลของ CEO');
      }

      let updatedRoleId = dto.roleId;

      // Auto-assign role from position if position is updated
      if (
        dto.positionId !== undefined &&
        dto.positionId !== employee.positionId
      ) {
        if (dto.positionId) {
          const position = await prisma.position.findUnique({
            where: { id: dto.positionId },
            include: { role: true },
          });
          if (position && position.roleId) {
            updatedRoleId = position.roleId;
            if (
              currentRole !== 'ceo' &&
              position.role?.name?.toLowerCase() === 'ceo'
            ) {
              throw new ForbiddenException(
                'ไม่สามารถกำหนดตำแหน่งที่เทียบเท่าระดับ CEO ได้',
              );
            }
          }
        }
      }

      if (!updatedRoleId && dto.roleName) {
        const role = await prisma.role.findFirst({
          where: { name: dto.roleName },
        });
        if (role) {
          updatedRoleId = role.id;
          if (currentRole !== 'ceo' && role.name.toLowerCase() === 'ceo') {
            throw new ForbiddenException('ไม่สามารถกำหนดสิทธิ์เป็น CEO ได้');
          }
        }
      }

      if (updatedRoleId && currentRole !== 'ceo') {
        const checkRole = await prisma.role.findUnique({
          where: { id: updatedRoleId },
        });
        if (checkRole && checkRole.name.toLowerCase() === 'ceo') {
          throw new ForbiddenException('ไม่สามารถกำหนดสิทธิ์เป็น CEO ได้');
        }
      }

      if (dto.email || dto.username || updatedRoleId) {
        if (dto.email) {
          const existingUserByEmail = await prisma.user.findUnique({
            where: { email: dto.email.trim() },
            select: { id: true },
          });
          if (
            existingUserByEmail &&
            existingUserByEmail.id !== employee.userId
          ) {
            throw new ConflictException('อีเมลนี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว');
          }
        }

        if (dto.username) {
          const existingUserByUsername = await prisma.user.findUnique({
            where: { username: dto.username.trim() },
            select: { id: true },
          });
          if (
            existingUserByUsername &&
            existingUserByUsername.id !== employee.userId
          ) {
            throw new ConflictException(
              'ชื่อผู้ใช้นี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว',
            );
          }
        }

        try {
          await prisma.user.update({
            where: { id: employee.userId },
            data: {
              ...(dto.email ? { email: dto.email.trim() } : {}),
              ...(dto.username ? { username: dto.username.trim() } : {}),
              ...(updatedRoleId ? { roleId: updatedRoleId } : {}),
            },
          });
        } catch (error: any) {
          if (error.code === 'P2002') {
            throw new ConflictException(
              'อีเมลหรือชื่อผู้ใช้นี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว',
            );
          }
          throw error;
        }
      }

      return prisma.employee.update({
        where: { id },
        data: {
          employeeCode:
            dto.employeeCode !== undefined ? dto.employeeCode : undefined,
          title: dto.title !== undefined ? dto.title : undefined,
          firstName: dto.firstName !== undefined ? dto.firstName : undefined,
          lastName: dto.lastName !== undefined ? dto.lastName : undefined,
          gender: dto.gender !== undefined ? dto.gender : undefined,
          phone: dto.phone !== undefined ? dto.phone : undefined,
          departmentId: dto.departmentId || undefined,
          positionId: dto.positionId || undefined,
          hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
          firstNameEN:
            dto.firstNameEN !== undefined ? dto.firstNameEN : undefined,
          lastNameEN: dto.lastNameEN !== undefined ? dto.lastNameEN : undefined,
          idCardNumber:
            dto.idCardNumber !== undefined ? dto.idCardNumber : undefined,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          idCardAddress:
            dto.idCardAddress !== undefined ? dto.idCardAddress : undefined,
          currentAddress:
            dto.currentAddress !== undefined ? dto.currentAddress : undefined,
        },
      });
    });
  }

  async updateEmployeeStatus(currentUser: any, id: string, isActive: boolean) {
    // Ensure isActive is a real boolean (not string "false")
    const active = isActive === true || isActive === ('true' as any);

    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { user: { include: { role: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const targetRoleName = employee.user?.role?.name?.toLowerCase();
    const currentRole = currentUser?.role?.toLowerCase();
    if (currentRole !== 'ceo' && targetRoleName === 'ceo') {
      throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขสถานะของ CEO');
    }

    await this.prisma.user.update({
      where: { id: employee.userId },
      data: {
        isActive: active,
        ...(active === false ? { refreshToken: null } : {}),
      },
    });

    try {
      await this.prisma.auditLog.create({
        data: {
          id: require('crypto').randomUUID(),
          action: active ? 'ENABLE_USER' : 'DISABLE_USER',
          entity: 'User',
          entityId: employee.userId,
          details: `User status changed to ${active ? 'active' : 'inactive'}`,
          updatedAt: new Date(),
        },
      });
    } catch (e) {
      console.log('Failed to create audit log', e);
    }

    return { success: true, isActive: active };
  }

  async findAllEmployees() {
    const employees = await this.prisma.employee.findMany({
      include: {
        user: {
          select: {
            email: true,
            username: true,
            isActive: true,
            role: { select: { name: true } },
          },
        },
        department: true,
        position: true,
      },
    });

    return employees.map((e) => ({
      ...e,
      employeeId: e.employeeCode || `EMP-${e.id.substring(0, 5).toUpperCase()}`,
      username: e.user?.username || e.user?.email || '',
      email: e.user?.email || '',
      role: e.user?.role?.name?.toLowerCase() || '',
      departmentName: e.department?.name || '',
      positionTitle: e.position?.name || '',
      positionName: e.position?.name || '',
      status: e.user?.isActive !== false ? 'active' : 'inactive',
    }));
  }

  async findEmployeeById(currentUser: any, id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        user: { select: { email: true, role: true, isActive: true } },
        department: true,
        position: true,
        leaveBalances: {
          include: { leaveType: true },
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const targetRoleName = employee.user?.role?.name?.toLowerCase();
    const currentRole = currentUser?.role?.toLowerCase();
    if (currentRole !== 'ceo' && targetRoleName === 'ceo') {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลของ CEO');
    }

    return employee;
  }

  async initializeLeaveBalances(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { leaveBalances: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const currentYear = new Date().getFullYear();
    const existingBalances = employee.leaveBalances.filter(
      (b) => b.year === currentYear,
    );
    const prevYearBalances = employee.leaveBalances.filter(
      (b) => b.year === currentYear - 1,
    );
    const leaveTypes = await this.prisma.leaveType.findMany();

    const newBalances: any[] = [];
    let updatedCount = 0;
    for (const type of leaveTypes) {
      const existingBalance = existingBalances.find(
        (b) => b.leaveTypeId === type.id,
      );

      let initialTotalDays = type.defaultDays;

      // Special logic for vacation carry-over (max 12 days)
      if (type.name.includes('พักผ่อน') || type.name.includes('พักร้อน')) {
        const prevBalance = prevYearBalances.find(
          (b) => b.leaveTypeId === type.id,
        );
        if (prevBalance) {
          const carriedOver = prevBalance.remainingDays;
          initialTotalDays = Math.min(12, carriedOver + type.defaultDays);
        }
      }

      if (!existingBalance) {
        const balance = await this.prisma.leaveBalance.create({
          data: {
            employeeId,
            leaveTypeId: type.id,
            year: currentYear,
            totalDays: initialTotalDays,
            usedDays: 0,
            remainingDays: initialTotalDays,
          },
        });
        newBalances.push(balance);
      } else if (
        existingBalance.totalDays !== initialTotalDays ||
        existingBalance.usedDays < 0
      ) {
        const fixedUsedDays = Math.max(0, existingBalance.usedDays);
        await this.prisma.leaveBalance.update({
          where: { id: existingBalance.id },
          data: {
            totalDays: initialTotalDays,
            usedDays: fixedUsedDays,
            remainingDays: initialTotalDays - fixedUsedDays,
          },
        });
        updatedCount++;
      }
    }
    return {
      success: true,
      initialized: newBalances.length,
      updated: updatedCount,
    };
  }

  async resetLeaveBalances(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { leaveBalances: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const currentYear = new Date().getFullYear();
    const existingBalances = employee.leaveBalances.filter(
      (b) => b.year === currentYear,
    );

    for (const balance of existingBalances) {
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          usedDays: 0,
          remainingDays: balance.totalDays,
        },
      });
    }

    return { success: true, message: 'Reset successful' };
  }

  async getDashboardStats(userId: string, targetYear?: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const currentYear = targetYear || today.getFullYear();

    const [
      totalEmployees,
      pendingRequests,
      announcements,
      activities,
      employee,
    ] = await Promise.all([
      this.prisma.employee.count(),
      this.prisma.leaveRequest.count({ where: { status: 'PENDING_VERIFY' } }),
      this.prisma.announcement.findMany({
        take: 2,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.leaveRequest.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        include: { leaveType: true, employee: true },
      }),
      this.prisma.employee.findUnique({
        where: { userId },
        include: {
          leaveBalances: {
            include: { leaveType: true },
          },
          leaveRequests: true,
        },
      }),
    ]);

    const leavesTodayCount = await this.prisma.leaveRequest.count({
      where: {
        status: 'APPROVED',
        startDate: { lte: tomorrow },
        endDate: { gte: today },
      },
    });

    const monthlyStatsRaw = await this.prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: {
          gte: new Date(`${currentYear}-01-01`),
          lt: new Date(`${currentYear + 1}-01-01`),
        },
      },
      select: { startDate: true, employeeId: true },
    });

    const monthlyEmployeeSets = Array.from(
      { length: 12 },
      () => new Set<string>(),
    );
    monthlyStatsRaw.forEach((req) => {
      const month = new Date(req.startDate).getMonth();
      monthlyEmployeeSets[month].add(req.employeeId);
    });

    const monthlyCounts = monthlyEmployeeSets.map((set) => set.size);

    const thaiMonths = [
      'ม.ค.',
      'ก.พ.',
      'มี.ค.',
      'เม.ย.',
      'พ.ค.',
      'มิ.ย.',
      'ก.ค.',
      'ส.ค.',
      'ก.ย.',
      'ต.ค.',
      'พ.ย.',
      'ธ.ค.',
    ];
    const chartData = thaiMonths.map((name, index) => ({
      name,
      value: monthlyCounts[index],
    }));

    const formattedActivities = activities.map((r: any) => {
      let color = 'bg-orange-400';
      let statusText = 'ส่งคำขอแล้ว';
      const upperStatus = r.status?.toUpperCase() || '';
      if (upperStatus === 'APPROVED' || upperStatus.includes('APPROVED')) {
        color = 'bg-emerald-400';
        statusText = 'อนุมัติแล้ว';
      } else if (
        upperStatus === 'REJECTED' ||
        upperStatus.includes('REJECTED')
      ) {
        color = 'bg-red-400';
        statusText = 'ถูกปฏิเสธ';
      }

      const timeDiff = Date.now() - new Date(r.createdAt).getTime();
      const hours = Math.floor(timeDiff / (1000 * 60 * 60));
      let timeStr = `${hours} ชม. ที่แล้ว`;
      if (hours > 24) timeStr = `${Math.floor(hours / 24)} วันที่แล้ว`;
      else if (hours === 0) timeStr = `เมื่อไม่นานมานี้`;

      return {
        title: `${r.employee?.firstName || 'พนักงาน'} ลา${r.leaveType?.name || ''} - ${statusText}`,
        time: timeStr,
        color,
      };
    });

    // Personal Stats
    let remainingVacation = 0;
    let personalPending = 0;
    let personalApproved = 0;
    let personalRejected = 0;

    if (employee) {
      const vacationBalance = employee.leaveBalances.find(
        (b) =>
          b.year === currentYear &&
          (b.leaveType?.name.includes('พักผ่อน') ||
            b.leaveType?.name.includes('พักร้อน')),
      );
      if (vacationBalance) remainingVacation = vacationBalance.remainingDays;

      personalPending = employee.leaveRequests.filter((r) =>
        r.status.startsWith('PENDING_'),
      ).length;
      personalApproved = employee.leaveRequests.filter(
        (r) =>
          r.status?.toUpperCase() === 'APPROVED' &&
          new Date(r.startDate).getFullYear() === currentYear,
      ).length;
      personalRejected = employee.leaveRequests.filter(
        (r) => r.status?.toUpperCase() === 'REJECTED',
      ).length;
    }

    return {
      success: true,
      data: {
        totalEmployees,
        leavesToday: leavesTodayCount,
        remainingEmployees: totalEmployees - leavesTodayCount,
        pendingRequests,
        chartData,
        announcements: announcements,
        activities: formattedActivities,
        personal: {
          remainingVacation,
          pendingApprovals: personalPending,
          approvedThisYear: personalApproved,
          rejectedRequests: personalRejected,
        },
      },
    };
  }

  async getLeaveSummary(filters: {
    searchQuery?: string;
    startDate?: string;
    endDate?: string;
    leaveTypeId?: string;
    status?: string;
  }) {
    const { searchQuery, startDate, endDate, leaveTypeId, status } = filters;

    const leaveTypes = await this.prisma.leaveType.findMany();

    const employeeWhere: any = {};
    if (searchQuery) {
      employeeWhere.OR = [
        { firstName: { contains: searchQuery } },
        { lastName: { contains: searchQuery } },
        { employeeCode: { contains: searchQuery } },
      ];
    }

    if (status && status !== 'all') {
      employeeWhere.user = { isActive: status === 'active' };
    }

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      include: {
        department: true,
        leaveBalances: {
          where: { year: new Date().getFullYear() },
          include: { leaveType: true },
        },
        leaveRequests: {
          where: {
            status: 'APPROVED',
            ...(startDate ? { startDate: { gte: new Date(startDate) } } : {}),
            ...(endDate ? { endDate: { lte: new Date(endDate) } } : {}),
            ...(leaveTypeId && leaveTypeId !== 'all' ? { leaveTypeId } : {}),
          },
          include: { leaveType: true },
        },
      },
    });

    const summary = employees.map((emp) => {
      const leaveData: Record<string, number> = {};
      const remainingData: Record<string, number> = {};
      let totalUsedDays = 0;
      let totalRemainingDays = 0;

      leaveTypes.forEach((lt) => {
        leaveData[lt.name] = 0;
        remainingData[lt.name] = 0;
      });

      emp.leaveRequests.forEach((req) => {
        const typeName = req.leaveType?.name;
        if (typeName) {
          leaveData[typeName] = (leaveData[typeName] || 0) + req.totalDays;
          totalUsedDays += req.totalDays;
        }
      });

      emp.leaveBalances.forEach((bal) => {
        const typeName = bal.leaveType?.name;
        if (typeName) {
          remainingData[typeName] = bal.remainingDays;
          totalRemainingDays += bal.remainingDays;
        }
      });

      return {
        id: emp.id,
        employeeCode: emp.employeeCode || '',
        firstName: emp.firstName,
        lastName: emp.lastName,
        department: emp.department?.name || 'N/A',
        leaveData,
        remainingData,
        totalUsedDays,
        totalRemainingDays,
        leaveDates: [],
      };
    });

    return {
      success: true,
      data: {
        leaveTypes: leaveTypes.map((lt) => ({
          id: lt.id,
          name: lt.name,
          defaultDays: lt.defaultDays,
        })),
        summary,
      },
    };
  }

  async deleteEmployee(currentUser: any, id: string) {
    // Delete user and employee
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { user: { include: { role: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const targetRoleName = employee.user?.role?.name?.toLowerCase();
    const currentRole = currentUser?.role?.toLowerCase();
    if (currentRole !== 'ceo' && targetRoleName === 'ceo') {
      throw new ForbiddenException('ไม่มีสิทธิ์ลบข้อมูลของ CEO');
    }

    return this.prisma.$transaction(async (prisma) => {
      await prisma.employee.delete({ where: { id } });
      if (employee.userId) {
        await prisma.user.delete({ where: { id: employee.userId } });
      }
    });
  }

  // --- Leaves ---
  async findAllLeaves() {
    const leaves = await this.prisma.leaveRequest.findMany({
      include: {
        employee: {
          include: {
            department: true,
            position: true,
            user: { include: { role: true } },
          },
        },
        leaveType: true,
        attachments: true,
        approvals: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return leaves.map((leave) => ({
      id: leave.id,
      requestCode: leave.requestCode,
      employeeId: leave.employeeId,
      leaveTypeId: leave.leaveTypeId,
      employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
      departmentName: leave.employee.department?.name || 'N/A',
      leaveTypeName: leave.leaveType.name,
      type: leave.leaveType.name,
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      startFormat: leave.startFormat,
      endFormat: leave.endFormat,
      leaveHours: Number((leave.totalDays * 8).toFixed(1)),
      totalDays: leave.totalDays,
      paidDays: leave.paidDays,
      unpaidDays: leave.unpaidDays,
      durationDays: leave.totalDays,
      reason: leave.reason,
      status: leave.status,
      attachmentUrl:
        leave.attachments && leave.attachments.length > 0
          ? leave.attachments[0].filePath
          : null,
      createdAt: leave.createdAt,
      approvals: leave.approvals,
      employee: {
        id: leave.employee.id,
        employeeCode: leave.employee.employeeCode,
        title: leave.employee.title,
        firstName: leave.employee.firstName,
        lastName: leave.employee.lastName,
        department: leave.employee.department,
        position: leave.employee.position,
        user: leave.employee.user,
      },
    }));
  }

  // --- Public Holidays ---
  async createHoliday(dto: CreatePublicHolidayDto) {
    return this.prisma.publicHoliday.create({
      data: {
        name: dto.name,
        date: new Date(dto.date),
      },
    });
  }

  async findAllHolidays() {
    return this.prisma.publicHoliday.findMany({
      orderBy: { date: 'asc' },
    });
  }

  async updateHoliday(id: string, dto: UpdatePublicHolidayDto) {
    return this.prisma.publicHoliday.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.date ? { date: new Date(dto.date) } : {}),
      },
    });
  }

  async deleteHoliday(id: string) {
    return this.prisma.publicHoliday.delete({ where: { id } });
  }

  // --- Leave Balance ---
  async updateLeaveBalance(id: string, dto: UpdateLeaveBalanceDto) {
    const balance = await this.prisma.leaveBalance.findUnique({
      where: { id },
    });
    if (!balance) {
      throw new NotFoundException('Leave balance not found');
    }

    const newTotalDays =
      dto.totalDays !== undefined ? dto.totalDays : balance.totalDays;
    const newRemainingDays =
      dto.remainingDays !== undefined
        ? dto.remainingDays
        : balance.remainingDays;

    if (newRemainingDays < 0 || newRemainingDays > newTotalDays) {
      throw new BadRequestException(
        `Remaining leave balance must be between 0 and ${newTotalDays}`,
      );
    }

    return this.prisma.leaveBalance.update({
      where: { id },
      data: {
        totalDays: newTotalDays,
        remainingDays: newRemainingDays,
        usedDays: newTotalDays - newRemainingDays,
      },
    });
  }
  // --- Leave Verification (HR) ---
  async getPendingVerify() {
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        status: {
          in: ['PENDING_VERIFY', 'REVIEWING_HR', 'PENDING_CANCELLATION'],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            title: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            position: { select: { name: true } },
            user: {
              select: {
                id: true,
                avatarUrl: true,
                role: { select: { name: true } },
              },
            },
          },
        },
        leaveType: true,
        attachments: true,
        approvals: { orderBy: { createdAt: 'desc' } },
      },
    });

    const reviewerIds = [
      ...new Set(
        requests.map((request) => request.currentHrReviewerId).filter(Boolean),
      ),
    ] as string[];
    const reviewers = reviewerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: reviewerIds } },
          select: { id: true, username: true, email: true },
        })
      : [];
    const reviewerById = new Map(
      reviewers.map((reviewer) => [reviewer.id, reviewer]),
    );

    return requests.map((request) => ({
      ...request,
      currentReviewer: request.currentHrReviewerId
        ? (reviewerById.get(request.currentHrReviewerId) ?? null)
        : null,
    }));
  }

  async markAsViewed(
    hrUserId: string,
    requestId: string,
    lockRequest: boolean = true,
  ) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new BadRequestException('Request not found');
    }
    if (request.status === 'PENDING_CANCELLATION') {
      return this.prisma.leaveRequest.update({
        where: { id: requestId },
        data: { isViewedByHr: true },
      });
    }
    if (!['PENDING_VERIFY', 'REVIEWING_HR'].includes(request.status)) {
      throw new BadRequestException(
        'This request is no longer waiting for HR review',
      );
    }

    if (lockRequest) {
      if (
        request.currentHrReviewerId &&
        request.currentHrReviewerId !== hrUserId
      ) {
        throw new BadRequestException('คำขอนี้กำลังถูกตรวจสอบโดย HR คนอื่น');
      }

      // Check if this HR user has already locked any other request
      const existingLocked = await this.prisma.leaveRequest.findFirst({
        where: {
          currentHrReviewerId: hrUserId,
          status: 'REVIEWING_HR',
          id: { not: requestId },
        },
      });
      if (existingLocked) {
        throw new BadRequestException(
          'คุณมีรายการคำขออื่นที่กำลังตรวจสอบอยู่ กรุณาจัดการรายการนั้นให้เสร็จสิ้นก่อนดึงคำขอใหม่',
        );
      }

      // updateMany makes acquisition atomic: only the first HR can change a waiting request.
      const acquired = await this.prisma.leaveRequest.updateMany({
        where: {
          id: requestId,
          status: 'PENDING_VERIFY',
          currentHrReviewerId: null,
        },
        data: {
          isViewedByHr: true,
          status: 'REVIEWING_HR',
          currentHrReviewerId: hrUserId,
          hrReviewStartedAt: new Date(),
        },
      });

      if (acquired.count === 0 && request.currentHrReviewerId !== hrUserId) {
        // If we couldn't acquire it, it means another HR just took it.
        throw new BadRequestException('คำขอนี้กำลังถูกตรวจสอบโดย HR คนอื่น');
      }
    } else {
      await this.prisma.leaveRequest.update({
        where: { id: requestId },
        data: { isViewedByHr: true },
      });
    }

    return this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
  }

  async processLeaveRequest(
    hrUserId: string,
    requestId: string,
    action: 'Approve' | 'Reject',
    dto: { comment?: string },
  ) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: {
        leaveType: true,
        employee: { include: { user: { include: { role: true } } } },
      },
    });

    if (
      !request ||
      !['PENDING_VERIFY', 'REVIEWING_HR', 'PENDING_CANCELLATION'].includes(
        request.status,
      )
    ) {
      throw new BadRequestException('Invalid request or already verified');
    }

    if (
      request.status === 'REVIEWING_HR' &&
      request.currentHrReviewerId !== hrUserId
    ) {
      throw new BadRequestException('คำขอนี้กำลังถูกตรวจสอบโดย HR คนอื่น');
    }

    if (action === 'Reject' && !dto.comment?.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    // The normal UI acquires the lock when an HR user opens the request.  Keep
    // the decision endpoint safe too, so a direct API call cannot bypass it.
    if (request.status === 'PENDING_VERIFY') {
      const acquired = await this.prisma.leaveRequest.updateMany({
        where: {
          id: requestId,
          status: 'PENDING_VERIFY',
          currentHrReviewerId: null,
        },
        data: {
          status: 'REVIEWING_HR',
          currentHrReviewerId: hrUserId,
          hrReviewStartedAt: new Date(),
        },
      });
      if (acquired.count !== 1) {
        throw new BadRequestException('คำขอนี้กำลังถูกตรวจสอบโดย HR คนอื่น');
      }
    }

    if (request.status === 'PENDING_CANCELLATION') {
      if (action === 'Approve') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startDay = new Date(request.startDate);
        startDay.setHours(0, 0, 0, 0);
        if (startDay <= today) {
          throw new BadRequestException(
            'Cannot cancel an approved leave on or after its start date',
          );
        }
      }

      const nextStatus = action === 'Approve' ? 'CANCELLED' : 'APPROVED';
      return this.prisma
        .$transaction(async (prisma) => {
          const updatedRequest = await prisma.leaveRequest.update({
            where: { id: requestId },
            data: { status: nextStatus },
          });

          await prisma.leaveApproval.create({
            data: {
              leaveRequestId: requestId,
              approverId: hrUserId,
              status: nextStatus,
              comment: dto.comment?.trim() || null,
            },
          });

          if (action === 'Approve') {
            const balance = await prisma.leaveBalance.findFirst({
              where: {
                employeeId: request.employeeId,
                leaveTypeId: request.leaveTypeId,
                year: new Date(request.startDate).getFullYear(),
              },
            });
            if (balance) {
              const newRemainingDays = Math.min(
                balance.totalDays,
                balance.remainingDays + request.totalDays,
              );
              await prisma.leaveBalance.update({
                where: { id: balance.id },
                data: {
                  usedDays: Math.max(0, balance.totalDays - newRemainingDays),
                  remainingDays: newRemainingDays,
                },
              });
            }
          }
          return updatedRequest;
        })
        .then(async (updatedRequest) => {
          const employeeUser = request.employee.user;
          if (employeeUser?.id) {
            const approved = action === 'Approve';
            await this.prisma.notification.create({
              data: {
                userId: employeeUser.id,
                title: approved
                  ? 'คำขอยกเลิกใบลาได้รับการอนุมัติ'
                  : 'คำขอยกเลิกใบลาถูกปฏิเสธ',
                message: approved
                  ? `คำขอยกเลิก${request.leaveType.name} ของคุณได้รับการอนุมัติและคืนโควตาแล้ว`
                  : `คำขอยกเลิก${request.leaveType.name} ของคุณถูกปฏิเสธ เหตุผล: ${dto.comment?.trim()}`,
                type: approved ? 'APPROVE' : 'REJECT',
                redirectUrl:
                  employeeUser.role?.name === 'Manager'
                    ? '/dashboard/manager/history'
                    : employeeUser.role?.name === 'HR'
                      ? '/dashboard/hr/leave-history'
                      : '/dashboard/user/history',
              },
            });
            if (employeeUser.email) {
              this.notificationService.sendEmail(
                employeeUser.email,
                approved
                  ? '[Leave Cancellation] อนุมัติแล้ว'
                  : '[Leave Cancellation] ไม่อนุมัติ',
                approved
                  ? `คำขอยกเลิก${request.leaveType.name} ของคุณได้รับการอนุมัติและคืนโควตาแล้ว`
                  : `คำขอยกเลิก${request.leaveType.name} ของคุณถูกปฏิเสธ\nเหตุผล: ${dto.comment?.trim()}`,
              );
            }
          }
          return updatedRequest;
        });
    }

    let nextStatus = '';
    if (action === 'Reject') {
      nextStatus = 'REJECTED';
    } else {
      const isManagerOrHR = ['Manager', 'HR'].includes(
        request.employee.user?.role?.name || '',
      );
      nextStatus = isManagerOrHR ? 'PENDING_EXECUTIVE' : 'PENDING_SUPERVISOR';
    }

    return this.prisma
      .$transaction(async (prisma) => {
        const updatedRequest = await prisma.leaveRequest.update({
          where: { id: requestId },
          data: {
            status: nextStatus,
            currentHrReviewerId: null,
            hrReviewStartedAt: null,
          },
        });

        await prisma.leaveApproval.create({
          data: {
            leaveRequestId: requestId,
            approverId: hrUserId,
            status: nextStatus,
            comment: dto.comment,
          },
        });

        return updatedRequest;
      })
      .then(async (updatedRequest) => {
        try {
          const employeeUser = await this.prisma.user.findUnique({
            where: { id: request.employee.userId },
          });

          if (action === 'Reject' && employeeUser?.email) {
            this.notificationService.sendEmail(
              employeeUser.email,
              `[Leave Request] คำขอลางานของคุณถูกปฏิเสธ (ตรวจสอบเบื้องต้น)`,
              `เรียน ${request.employee.firstName},\n\nคำขอ${request.leaveType.name} ของคุณถูกปฏิเสธในขั้นตอนตรวจสอบโดย HR\nเหตุผล: ${dto.comment || '-'}\n\nกรุณาเข้าสู่ระบบเพื่อยื่นคำขอใหม่หรือแก้ไข`,
            );
          } else if (
            action === 'Approve' &&
            nextStatus === 'PENDING_SUPERVISOR'
          ) {
            // Notify managers
            const managers = await this.prisma.employee.findMany({
              where: {
                departmentId: request.employee.departmentId,
                user: { role: { name: 'Manager' } },
              },
              include: { user: true },
            });
            for (const m of managers) {
              if (m.user?.id) {
                await this.prisma.notification.create({
                  data: {
                    userId: m.user.id,
                    title: 'มีคำขอลาผ่านการตรวจสอบแล้ว',
                    message: `คำขอลาของ ${request.employee.firstName} ผ่านการตรวจสอบจาก HR แล้ว รอการอนุมัติจากคุณ`,
                    type: 'NEW_ORDER',
                    redirectUrl: '/dashboard/manager/approve',
                  },
                });
              }
              if (m.user?.email) {
                this.notificationService.sendEmail(
                  m.user.email,
                  `[Leave Request] คำขอลาของ ${request.employee.firstName} รอการอนุมัติ`,
                  `เรียน ${m.firstName},\n\nคำขอลาของ ${request.employee.firstName} ผ่านการตรวจสอบเบื้องต้นแล้ว\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติ`,
                );
              }
            }
          } else if (
            action === 'Approve' &&
            nextStatus === 'PENDING_EXECUTIVE'
          ) {
            const ceos = await this.prisma.user.findMany({
              where: { role: { name: 'CEO' } },
            });
            for (const ceo of ceos) {
              await this.prisma.notification.create({
                data: {
                  userId: ceo.id,
                  title: 'มีคำขอลารอผู้บริหารอนุมัติ',
                  message: `คำขอ${request.leaveType.name} ของ ${request.employee.firstName} ${request.employee.lastName} รอการอนุมัติจากผู้บริหาร`,
                  type: 'NEW_ORDER',
                  redirectUrl: '/dashboard/ceo/approval',
                },
              });
              if (ceo.email) {
                this.notificationService.sendEmail(
                  ceo.email,
                  '[Leave Request] รอผู้บริหารอนุมัติ',
                  `คำขอ${request.leaveType.name} ของ ${request.employee.firstName} ${request.employee.lastName} รอการอนุมัติจากคุณ`,
                );
              }
            }
          }

          if (employeeUser?.id) {
            await this.prisma.notification.create({
              data: {
                userId: employeeUser.id,
                title:
                  action === 'Reject'
                    ? 'คำขอลาถูกปฏิเสธโดยฝ่ายบุคคล'
                    : 'คำขอลาผ่านการตรวจสอบเบื้องต้น',
                message:
                  action === 'Reject'
                    ? `เหตุผล: ${dto.comment || '-'}`
                    : `คำขอลาของคุณกำลังรอการอนุมัติจากหัวหน้างาน`,
                type: 'SYSTEM',
                redirectUrl: '/dashboard/user/history',
              },
            });
          }
        } catch (e) {
          console.error('Failed to send notification', e);
        }
        return updatedRequest;
      });
  }
}
