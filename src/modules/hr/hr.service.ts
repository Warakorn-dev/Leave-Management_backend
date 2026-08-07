import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto, CreatePositionDto, UpdatePositionDto, CreateLeaveTypeDto, UpdateLeaveTypeDto, CreateEmployeeDto, UpdateEmployeeDto, CreatePublicHolidayDto, UpdatePublicHolidayDto, UpdateLeaveBalanceDto } from './dto/hr.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class HrService {
  constructor(private prisma: PrismaService) { }

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

  // --- Positions ---
  async createPosition(dto: CreatePositionDto) {
    return this.prisma.position.create({ data: dto });
  }

  async findAllPositions() {
    return this.prisma.position.findMany({
      include: { department: true }
    });
  }

  async updatePosition(id: string, dto: UpdatePositionDto) {
    return this.prisma.$transaction(async (prisma) => {
      const position = await prisma.position.update({ where: { id }, data: dto });

      if (dto.departmentId) {
        await prisma.employee.updateMany({
          where: { positionId: id },
          data: { departmentId: dto.departmentId }
        });
      }

      return position;
    });
  }

  async deletePosition(id: string) {
    return this.prisma.position.delete({ where: { id } });
  }

  // --- Leave Types ---
  async createLeaveType(dto: CreateLeaveTypeDto) {
    return this.prisma.leaveType.create({
      data: {
        name: dto.name,
        defaultDays: dto.defaultDays,
        requiresCertificate: dto.requiresCertificate ?? false,
        isSpecial: dto.isSpecial ?? false,
        advanceNoticeDays: dto.advanceNoticeDays ?? 0,
        minTenureDays: dto.minTenureDays ?? 0
      }
    });
  }

  async findAllLeaveTypes() {
    return this.prisma.leaveType.findMany();
  }

  async updateLeaveType(id: string, dto: UpdateLeaveTypeDto) {
    return this.prisma.leaveType.update({
      where: { id },
      data: dto
    });
  }

  async deleteLeaveType(id: string) {
    return this.prisma.leaveType.delete({ where: { id } });
  }

  // --- Employees ---
  async createEmployee(dto: CreateEmployeeDto) {
    // Check if user email already exists
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    let roleId = dto.roleId;
    if (!roleId && dto.roleName) {
      const role = await this.prisma.role.findFirst({ where: { name: dto.roleName } });
      if (role) roleId = role.id;
    }

    if (!roleId) {
      const defaultRole = await this.prisma.role.findFirst({ where: { name: 'Employee' } });
      if (!defaultRole) {
        const userRole = await this.prisma.role.findFirst({ where: { name: 'User' } });
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
        },
      });

      // Initialize leave balances for the current year
      const currentYear = new Date().getFullYear();
      const leaveTypes = await prisma.leaveType.findMany();

      const balancePromises = leaveTypes.map(type =>
        prisma.leaveBalance.create({
          data: {
            employeeId: employee.id,
            leaveTypeId: type.id,
            year: currentYear,
            totalDays: type.defaultDays,
            usedDays: 0,
            remainingDays: type.defaultDays,
          }
        })
      );
      await Promise.all(balancePromises);

      return employee;
    });
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto) {
    return this.prisma.$transaction(async (prisma) => {
      const employee = await prisma.employee.findUnique({ where: { id } });
      if (!employee) throw new NotFoundException('Employee not found');

      let updatedRoleId = dto.roleId;
      if (!updatedRoleId && dto.roleName) {
        const role = await prisma.role.findFirst({ where: { name: dto.roleName } });
        if (role) updatedRoleId = role.id;
      }

      if (dto.email || dto.username || updatedRoleId) {
        await prisma.user.update({
          where: { id: employee.userId },
          data: {
            ...(dto.email ? { email: dto.email } : {}),
            ...(dto.username ? { username: dto.username } : {}),
            ...(updatedRoleId ? { roleId: updatedRoleId } : {})
          }
        });
      }

      return prisma.employee.update({
        where: { id },
        data: {
          employeeCode: dto.employeeCode !== undefined ? dto.employeeCode : undefined,
          title: dto.title !== undefined ? dto.title : undefined,
          firstName: dto.firstName !== undefined ? dto.firstName : undefined,
          lastName: dto.lastName !== undefined ? dto.lastName : undefined,
          gender: dto.gender !== undefined ? dto.gender : undefined,
          phone: dto.phone !== undefined ? dto.phone : undefined,
          departmentId: dto.departmentId !== undefined ? dto.departmentId : undefined,
          positionId: dto.positionId !== undefined ? dto.positionId : undefined,
          hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
        }
      });
    });
  }

  async updateEmployeeStatus(id: string, isActive: boolean) {
    // Ensure isActive is a real boolean (not string "false")
    const active = isActive === true || isActive === ('true' as any);

    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');

    await this.prisma.user.update({
      where: { id: employee.userId },
      data: {
        isActive: active,
        ...(active === false ? { refreshToken: null } : {})
      }
    });

    try {
      await this.prisma.auditLog.create({
        data: {
          id: require('crypto').randomUUID(),
          action: active ? 'ENABLE_USER' : 'DISABLE_USER',
          entity: 'User',
          entityId: employee.userId,
          details: `User status changed to ${active ? 'active' : 'inactive'}`,
          updatedAt: new Date()
        }
      });
    } catch (e) {
      console.log('Failed to create audit log', e);
    }

    return { success: true, isActive: active };
  }

  async findAllEmployees() {
    const employees = await this.prisma.employee.findMany({
      include: {
        user: { select: { email: true, username: true, isActive: true, role: { select: { name: true } } } },
        department: true,
        position: true,
      }
    });

    return employees.map(e => ({
      ...e,
      employeeId: e.employeeCode || `EMP-${e.id.substring(0, 5).toUpperCase()}`,
      username: e.user?.username || e.user?.email || '',
      email: e.user?.email || '',
      role: e.user?.role?.name?.toLowerCase() || '',
      departmentName: e.department?.name || '',
      positionTitle: e.position?.name || '',
      positionName: e.position?.name || '',
      status: e.user?.isActive !== false ? 'active' : 'inactive'
    }));
  }

  async findEmployeeById(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        user: { select: { email: true, role: true, isActive: true } },
        department: true,
        position: true,
        leaveBalances: {
          include: { leaveType: true }
        },
      }
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async initializeLeaveBalances(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { leaveBalances: true }
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const currentYear = new Date().getFullYear();
    const existingBalances = employee.leaveBalances.filter(b => b.year === currentYear);
    const prevYearBalances = employee.leaveBalances.filter(b => b.year === currentYear - 1);
    const leaveTypes = await this.prisma.leaveType.findMany();

    const newBalances: any[] = [];
    let updatedCount = 0;
    for (const type of leaveTypes) {
      const existingBalance = existingBalances.find(b => b.leaveTypeId === type.id);
      
      let initialTotalDays = type.defaultDays;

      // Special logic for vacation carry-over (max 12 days)
      if (type.name.includes('พักผ่อน') || type.name.includes('พักร้อน')) {
        const prevBalance = prevYearBalances.find(b => b.leaveTypeId === type.id);
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
          }
        });
        newBalances.push(balance);
      } else if (existingBalance.totalDays !== initialTotalDays || existingBalance.usedDays < 0) {
        const fixedUsedDays = Math.max(0, existingBalance.usedDays);
        await this.prisma.leaveBalance.update({
          where: { id: existingBalance.id },
          data: {
            totalDays: initialTotalDays,
            usedDays: fixedUsedDays,
            remainingDays: initialTotalDays - fixedUsedDays,
          }
        });
        updatedCount++;
      }
    }
    return { success: true, initialized: newBalances.length, updated: updatedCount };
  }

  async resetLeaveBalances(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { leaveBalances: true }
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const currentYear = new Date().getFullYear();
    const existingBalances = employee.leaveBalances.filter(b => b.year === currentYear);

    for (const balance of existingBalances) {
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          usedDays: 0,
          remainingDays: balance.totalDays
        }
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

    const [totalEmployees, pendingRequests, announcements, activities, employee] = await Promise.all([
      this.prisma.employee.count(),
      this.prisma.leaveRequest.count({ where: { status: 'Pending' } }),
      this.prisma.announcement.findMany({ take: 2, orderBy: { createdAt: 'desc' } }),
      this.prisma.leaveRequest.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        include: { leaveType: true, employee: true }
      }),
      this.prisma.employee.findUnique({
        where: { userId },
        include: {
          leaveBalances: {
            include: { leaveType: true }
          },
          leaveRequests: true
        }
      })
    ]);

    const leavesTodayCount = await this.prisma.leaveRequest.count({
      where: {
        status: { contains: 'Approved' },
        startDate: { lte: tomorrow },
        endDate: { gte: today }
      }
    });

    const monthlyStatsRaw = await this.prisma.leaveRequest.findMany({
      where: {
        status: { contains: 'Approved' },
        startDate: {
          gte: new Date(`${currentYear}-01-01`),
          lt: new Date(`${currentYear + 1}-01-01`)
        }
      },
      select: { startDate: true, employeeId: true }
    });

    const monthlyEmployeeSets = Array.from({ length: 12 }, () => new Set<string>());
    monthlyStatsRaw.forEach(req => {
      const month = new Date(req.startDate).getMonth();
      monthlyEmployeeSets[month].add(req.employeeId);
    });

    const monthlyCounts = monthlyEmployeeSets.map(set => set.size);

    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const chartData = thaiMonths.map((name, index) => ({
      name,
      value: monthlyCounts[index]
    }));

    const formattedActivities = activities.map((r: any) => {
      let color = "bg-orange-400";
      let statusText = "ส่งคำขอแล้ว";
      if (r.status.includes("Approved")) {
        color = "bg-emerald-400";
        statusText = "อนุมัติแล้ว";
      } else if (r.status.includes("Rejected")) {
        color = "bg-red-400";
        statusText = "ถูกปฏิเสธ";
      }

      const timeDiff = Date.now() - new Date(r.createdAt).getTime();
      const hours = Math.floor(timeDiff / (1000 * 60 * 60));
      let timeStr = `${hours} ชม. ที่แล้ว`;
      if (hours > 24) timeStr = `${Math.floor(hours / 24)} วันที่แล้ว`;
      else if (hours === 0) timeStr = `เมื่อไม่นานมานี้`;

      return {
        title: `${r.employee?.firstName || 'พนักงาน'} ลา${r.leaveType?.name || ''} - ${statusText}`,
        time: timeStr,
        color
      };
    });

    // Personal Stats
    let remainingVacation = 0;
    let personalPending = 0;
    let personalApproved = 0;
    let personalRejected = 0;

    if (employee) {
      const vacationBalance = employee.leaveBalances.find(b => b.year === currentYear && (b.leaveType?.name.includes('พักผ่อน') || b.leaveType?.name.includes('พักร้อน')));
      if (vacationBalance) remainingVacation = vacationBalance.remainingDays;

      personalPending = employee.leaveRequests.filter(r => r.status === 'Pending' || r.status === 'Waiting CEO').length;
      personalApproved = employee.leaveRequests.filter(r => r.status.includes('Approved') && new Date(r.startDate).getFullYear() === currentYear).length;
      personalRejected = employee.leaveRequests.filter(r => r.status.includes('Rejected')).length;
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
          rejectedRequests: personalRejected
        }
      }
    };
  }

  async getLeaveSummary(filters: { searchQuery?: string, startDate?: string, endDate?: string, leaveTypeId?: string, status?: string }) {
    const { searchQuery, startDate, endDate, leaveTypeId, status } = filters;

    const leaveTypes = await this.prisma.leaveType.findMany();

    const employeeWhere: any = {};
    if (searchQuery) {
      employeeWhere.OR = [
        { firstName: { contains: searchQuery } },
        { lastName: { contains: searchQuery } },
        { employeeCode: { contains: searchQuery } }
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
          include: { leaveType: true }
        },
        leaveRequests: {
          where: {
            status: { contains: 'Approved' },
            ...(startDate ? { startDate: { gte: new Date(startDate) } } : {}),
            ...(endDate ? { endDate: { lte: new Date(endDate) } } : {}),
            ...(leaveTypeId && leaveTypeId !== 'all' ? { leaveTypeId } : {})
          },
          include: { leaveType: true }
        }
      }
    });

    const summary = employees.map(emp => {
      const leaveData: Record<string, number> = {};
      const remainingData: Record<string, number> = {};
      let totalUsedDays = 0;
      let totalRemainingDays = 0;

      leaveTypes.forEach(lt => {
        leaveData[lt.name] = 0;
        remainingData[lt.name] = 0;
      });

      emp.leaveRequests.forEach(req => {
        const typeName = req.leaveType?.name;
        if (typeName) {
          leaveData[typeName] = (leaveData[typeName] || 0) + req.totalDays;
          totalUsedDays += req.totalDays;
        }
      });

      emp.leaveBalances.forEach(bal => {
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
        leaveDates: []
      };
    });

    return {
      success: true,
      data: {
        leaveTypes: leaveTypes.map(lt => ({ id: lt.id, name: lt.name })),
        summary
      }
    };
  }

  async deleteEmployee(id: string) {
    // Delete user and employee
    const employee = await this.prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!employee) throw new NotFoundException('Employee not found');

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
            user: { include: { role: true } }
          }
        },
        leaveType: true,
        attachments: true,
        approvals: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' }
    });

    return leaves.map(leave => ({
      id: leave.id,
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
      attachmentUrl: leave.attachments && leave.attachments.length > 0 ? leave.attachments[0].filePath : null,
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
        user: leave.employee.user
      }
    }));
  }

  // --- Public Holidays ---
  async createHoliday(dto: CreatePublicHolidayDto) {
    return this.prisma.publicHoliday.create({
      data: {
        name: dto.name,
        date: new Date(dto.date)
      }
    });
  }

  async findAllHolidays() {
    return this.prisma.publicHoliday.findMany({
      orderBy: { date: 'asc' }
    });
  }

  async updateHoliday(id: string, dto: UpdatePublicHolidayDto) {
    return this.prisma.publicHoliday.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.date ? { date: new Date(dto.date) } : {})
      }
    });
  }

  async deleteHoliday(id: string) {
    return this.prisma.publicHoliday.delete({ where: { id } });
  }

  // --- Leave Balance ---
  async updateLeaveBalance(id: string, dto: UpdateLeaveBalanceDto) {
    return this.prisma.leaveBalance.update({
      where: { id },
      data: {
        remainingDays: dto.remainingDays
      }
    });
  }
}
