import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  UpdateLeaveBalanceDto,
} from '../dto/hr.dto';
import * as bcrypt from 'bcrypt';

/** Employee CRUD, activation status, and leave-balance lifecycle. */
@Injectable()
export class HrEmployeeService {
  private readonly logger = new Logger(HrEmployeeService.name);

  constructor(private prisma: PrismaService) {}

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

  async updateEmployee(id: string, dto: UpdateEmployeeDto) {
    return this.prisma.$transaction(async (prisma) => {
      const employee = await prisma.employee.findUnique({ where: { id } });
      if (!employee) throw new NotFoundException('Employee not found');

      let updatedRoleId = dto.roleId;

      // Auto-assign role from position if position is updated
      if (
        dto.positionId !== undefined &&
        dto.positionId !== employee.positionId
      ) {
        if (dto.positionId) {
          const position = await prisma.position.findUnique({
            where: { id: dto.positionId },
          });
          if (position && position.roleId) {
            updatedRoleId = position.roleId;
          }
        }
      }

      if (!updatedRoleId && dto.roleName) {
        const role = await prisma.role.findFirst({
          where: { name: dto.roleName },
        });
        if (role) updatedRoleId = role.id;
      }

      if (dto.email || dto.username || updatedRoleId) {
        await prisma.user.update({
          where: { id: employee.userId },
          data: {
            ...(dto.email ? { email: dto.email } : {}),
            ...(dto.username ? { username: dto.username } : {}),
            ...(updatedRoleId ? { roleId: updatedRoleId } : {}),
          },
        });
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
          departmentId:
            dto.departmentId !== undefined ? dto.departmentId : undefined,
          positionId: dto.positionId !== undefined ? dto.positionId : undefined,
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

  async updateEmployeeStatus(id: string, isActive: boolean) {
    // Ensure isActive is a real boolean (not string "false")
    const active = isActive === true || isActive === ('true' as any);

    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');

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
          action: active ? 'ENABLE_USER' : 'DISABLE_USER',
          entity: 'User',
          entityId: employee.userId,
          details: `User status changed to ${active ? 'active' : 'inactive'}`,
        },
      });
    } catch (e) {
      this.logger.error('Failed to create audit log', e);
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

  async findEmployeeById(id: string) {
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

  async deleteEmployee(id: string) {
    // Delete user and employee
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.$transaction(async (prisma) => {
      await prisma.employee.delete({ where: { id } });
      if (employee.userId) {
        await prisma.user.delete({ where: { id: employee.userId } });
      }
    });
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
}
