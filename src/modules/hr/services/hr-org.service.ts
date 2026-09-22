import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreatePositionDto,
  UpdatePositionDto,
  CreateLeaveTypeDto,
  UpdateLeaveTypeDto,
  CreatePublicHolidayDto,
  UpdatePublicHolidayDto,
} from '../dto/hr.dto';

/** Org-structure CRUD: departments, roles, positions, leave types, public holidays. */
@Injectable()
export class HrOrgService {
  constructor(private prisma: PrismaService) {}

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
}
