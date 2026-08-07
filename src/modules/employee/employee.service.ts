import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateLeaveRequestDto, UpdateLeaveRequestDto } from './dto/employee.dto';
import { NotificationService } from '../notification/notification.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class EmployeeService {
  constructor(private prisma: PrismaService, private notificationService: NotificationService) {}

  async createLeaveRequest(userId: string, dto: CreateLeaveRequestDto) {
    const employee = await this.getEmployeeByUserId(userId);

    let startDate: Date;
    let endDate: Date;
    
    // Map new payload format (leaveMode) if provided
    // Map new payload format (leaveMode) if provided
    if (dto.leaveMode) {
      if (dto.leaveMode === 'hourly' && dto.leaveDate && dto.startTime && dto.endTime) {
        startDate = new Date(dto.leaveDate + 'T' + dto.startTime + ':00');
        endDate = new Date(dto.leaveDate + 'T' + dto.endTime + ':00');
        
        if (endDate <= startDate) {
          throw new BadRequestException('End time must be after start time');
        }
        
        const diffMs = endDate.getTime() - startDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        dto.startFormat = 'hourly';
        dto.endFormat = 'hourly';
        dto.leaveHours = diffHours;
      } else if ((dto.leaveMode === 'full_day' || dto.leaveMode === 'half_day') && dto.startDate && dto.endDate) {
        startDate = new Date(dto.startDate);
        endDate = new Date(dto.endDate);
        if (dto.period && dto.leaveMode === 'half_day') {
          dto.startFormat = dto.period;
          dto.endFormat = dto.period;
        } else {
          dto.startFormat = 'full';
          dto.endFormat = 'full';
        }
      } else {
        throw new BadRequestException('Incomplete data for the selected leave mode');
      }
    } else {
      // Fallback for old payload format
      startDate = new Date(dto.startDate!);
      endDate = new Date(dto.endDate!);
    }
    
    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before or equal to end date');
    }

    const holidays = await this.prisma.publicHoliday.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        }
      }
    });

    // Check Leave Balance
    const currentYear = new Date().getFullYear();
    const balance = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: dto.leaveTypeId,
          year: currentYear,
        }
      },
      include: {
        leaveType: true,
      }
    });

    if (!balance) {
      throw new BadRequestException('Leave balance not found');
    }

    const advanceNoticeDays = (balance.leaveType as any).advanceNoticeDays || 0;
    if (advanceNoticeDays > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const startDay = new Date(startDate);
      startDay.setHours(0, 0, 0, 0);

      const diffTime = startDay.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays < advanceNoticeDays) {
        throw new BadRequestException(`ต้องยื่นล่วงหน้าอย่างน้อย ${advanceNoticeDays} วัน (Requires ${advanceNoticeDays} days advance notice)`);
      }
    }

    const minTenureDays = (balance.leaveType as any).minTenureDays || 0;
    if (minTenureDays > 0) {
      const joinDate = new Date(employee.hireDate);
      const diffTime = startDate.getTime() - joinDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays < minTenureDays) {
        throw new BadRequestException(`ต้องมีอายุงานอย่างน้อย ${minTenureDays} วัน (Requires at least ${minTenureDays} days of tenure)`);
      }
    }

    const pendingLeave = await this.prisma.leaveRequest.aggregate({
      where: {
        employeeId: employee.id,
        leaveTypeId: dto.leaveTypeId,
        status: { in: ['Pending', 'Waiting CEO'] },
        startDate: { gte: new Date(`${currentYear}-01-01T00:00:00.000Z`) }
      },
      _sum: { totalDays: true }
    });
    const pendingDays = pendingLeave._sum.totalDays || 0;
    const effectiveRemainingDays = balance.remainingDays - pendingDays;

    const leaveTypeName = balance.leaveType.name;
    const isMaternityFemale = leaveTypeName.includes('คลอดบุตร') && employee.gender === 'Female';
    const calculatedDays = this.calculateWorkingDays(startDate, endDate, holidays.map(h => h.date), dto.startFormat, dto.endFormat, isMaternityFemale, dto.leaveHours);

    if (calculatedDays <= 0) {
      throw new BadRequestException('Leave duration must be greater than 0');
    }

    let paidDays = calculatedDays;
    let unpaidDays = 0;

    // 1. ลาป่วย
    if (leaveTypeName === 'ลาป่วย') {
      const prev = await this.prisma.leaveRequest.aggregate({
        where: { 
          employeeId: employee.id, 
          leaveTypeId: dto.leaveTypeId, 
          status: { notIn: ['Rejected', 'Cancelled'] },
          startDate: { gte: new Date(`${currentYear}-01-01`) }
        },
        _sum: { paidDays: true }
      });
      const usedPaid = prev._sum.paidDays || 0;
      paidDays = Math.min(calculatedDays, Math.max(0, 30 - usedPaid));
      unpaidDays = calculatedDays - paidDays;
    } 
    // 2. ลาเพื่อคลอดบุตร
    else if (leaveTypeName.includes('คลอดบุตร')) {
      if (employee.gender === 'Female') {
        if (calculatedDays > 135) throw new BadRequestException('สิทธิลาเพื่อคลอดบุตร สำหรับพนักงานหญิง ไม่เกิน 120 วัน (และลาเพิ่มได้อีก 15 วันหากมีใบรับรองแพทย์)');
        
        let extraPaid = 0;
        if (calculatedDays > 120) {
           extraPaid = (calculatedDays - 120) * 0.5;
        }
        paidDays = Math.min(calculatedDays, 60) + extraPaid;
        unpaidDays = calculatedDays - paidDays;
      } else if (employee.gender === 'Male') {
        if (calculatedDays > 15) throw new BadRequestException('สิทธิลาเพื่อช่วยเหลือภริยาคลอดบุตร สำหรับพนักงานชาย ไม่เกิน 15 วัน');
        paidDays = calculatedDays;
        unpaidDays = 0;
      } else {
        throw new BadRequestException('ไม่ระบุเพศพนักงาน ไม่สามารถใช้สิทธิลาคลอดได้ โปรดติดต่อ HR');
      }
    }
    // 3. ลาเพื่อรับราชการทหาร
    else if (leaveTypeName.includes('ทหาร')) {
      const prev = await this.prisma.leaveRequest.aggregate({
        where: { 
          employeeId: employee.id, 
          leaveTypeId: dto.leaveTypeId, 
          status: { notIn: ['Rejected', 'Cancelled'] },
          startDate: { gte: new Date(`${currentYear}-01-01`) }
        },
        _sum: { paidDays: true }
      });
      const usedPaid = prev._sum.paidDays || 0;
      paidDays = Math.min(calculatedDays, Math.max(0, 60 - usedPaid));
      unpaidDays = calculatedDays - paidDays;
    }
    // 4. ลาพักผ่อนประจำปี (พักร้อน)
    else if (leaveTypeName === 'ลาพักผ่อนประจำปี (พักร้อน)') {
      const msInYear = 1000 * 60 * 60 * 24 * 365;
      const workDurationMs = new Date().getTime() - new Date(employee.hireDate).getTime();
      if (workDurationMs < msInYear) {
        throw new BadRequestException('คุณต้องมีอายุงานครบ 1 ปี จึงจะสามารถใช้สิทธิลาพักผ่อนประจำปีได้');
      }
      if (effectiveRemainingDays < calculatedDays) {
        throw new BadRequestException(`สิทธิวันลาไม่เพียงพอ (เหลือเพียง ${effectiveRemainingDays} วัน)`);
      }
      paidDays = calculatedDays;
    } 
    // 4. ลาเพื่อทำหมัน
    else if (leaveTypeName.includes('ทำหมัน')) {
      paidDays = calculatedDays;
      unpaidDays = 0;
    }
    // Other leaves (ลากิจ และอื่นๆ)
    else {
      if (effectiveRemainingDays < calculatedDays) {
        throw new BadRequestException(`สิทธิวันลาไม่เพียงพอ (เหลือเพียง ${effectiveRemainingDays} วัน)`);
      }
      paidDays = calculatedDays;
    }

    // Create Leave Request
    const leaveRequest = await this.prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: dto.leaveTypeId,
        startDate: startDate,
        endDate: endDate,
        startFormat: dto.startFormat || 'full',
        endFormat: dto.endFormat || 'full',
        totalDays: calculatedDays,
        paidDays: paidDays,
        unpaidDays: unpaidDays,
        reason: dto.reason,
        status: ['Manager', 'HR'].includes(employee.user?.role?.name) ? 'Waiting CEO' : 'Pending',
      }
    });

    // Notify Approver(s)
    try {
      let durationText = `${calculatedDays} วัน`;
      if (dto.leaveMode === 'hourly' || dto.startFormat === 'hourly' || dto.leaveHours || (calculatedDays > 0 && calculatedDays < 0.5)) {
        const hours = dto.leaveHours || Math.round(calculatedDays * 8 * 100) / 100;
        durationText = `${hours} ชั่วโมง`;
      } else if (dto.leaveMode === 'half_day' || calculatedDays === 0.5) {
        const periodLabel = (dto.period === 'morning' || dto.startFormat === 'morning') ? 'ช่วงเช้า' : (dto.period === 'afternoon' || dto.startFormat === 'afternoon') ? 'ช่วงบ่าย' : 'ครึ่งวัน';
        durationText = `0.5 วัน (${periodLabel})`;
      }

      const startDateStr = startDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
      const endDateStr = endDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
      
      let leaveTimeDetail = '';
      if (dto.leaveMode === 'hourly' || dto.startFormat === 'hourly') {
        const startTimeStr = startDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        const endTimeStr = endDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        leaveTimeDetail = `วันที่ ${startDateStr} เวลา ${startTimeStr} - ${endTimeStr} น.`;
      } else if (startDateStr === endDateStr) {
        leaveTimeDetail = `วันที่ ${startDateStr}`;
      } else {
        leaveTimeDetail = `วันที่ ${startDateStr} - ${endDateStr}`;
      }

      if (leaveRequest.status === 'Pending') {
        const managers = await this.prisma.employee.findMany({
          where: { departmentId: employee.departmentId, user: { role: { name: 'Manager' } } },
          include: { user: true }
        });
        for (const m of managers) {
          if (m.user?.id) {
            await this.prisma.notification.create({
              data: {
                userId: m.user.id,
                title: 'มีคำขอลาใหม่ในแผนก',
                message: `พนักงาน "${employee.firstName} ${employee.lastName}" ได้ยื่นคำขอ ${leaveTypeName} (${durationText}) ${leaveTimeDetail}`,
                type: 'NEW_ORDER',
                redirectUrl: '/dashboard/manager/approve',
              }
            });
          }
          if (m.user?.email) {
            this.notificationService.sendEmail(
              m.user.email,
              `[Leave Request] ${employee.firstName} ${employee.lastName} ได้ยื่นคำขอลางาน`,
              `เรียน ${m.firstName},\n\n${employee.firstName} ${employee.lastName} ได้ยื่นคำขอ${leaveTypeName} (${durationText}) ${leaveTimeDetail}\nเหตุผล: ${dto.reason}\n\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติ`
            );
          }
        }
      } else if (leaveRequest.status === 'Waiting CEO') {
        const ceos = await this.prisma.user.findMany({
          where: { role: { name: 'CEO' } }
        });
        for (const ceo of ceos) {
          if (ceo.id) {
            await this.prisma.notification.create({
              data: {
                userId: ceo.id,
                title: 'มีคำขอลาจากผู้จัดการแผนก',
                message: `ผู้จัดการแผนก "${employee.firstName} ${employee.lastName}" ได้ยื่นคำขอ ${leaveTypeName} (${durationText}) ${leaveTimeDetail}`,
                type: 'NEW_ORDER',
                redirectUrl: '/dashboard/ceo/approval',
              }
            });
          }
          if (ceo.email) {
            this.notificationService.sendEmail(
              ceo.email,
              `[Leave Request] ${employee.firstName} ${employee.lastName} ได้ยื่นคำขอลางาน`,
              `เรียน CEO,\n\n${employee.firstName} ${employee.lastName} ได้ยื่นคำขอ${leaveTypeName} (${durationText}) ${leaveTimeDetail}\nเหตุผล: ${dto.reason}\n\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติ`
            );
          }
        }
      }
    } catch (e) {
      console.error('Failed to send notification', e);
    }

    return leaveRequest;
  }

  async updateLeaveRequest(userId: string, requestId: string, dto: UpdateLeaveRequestDto) {
    const employee = await this.getEmployeeByUserId(userId);
    const request = await this.prisma.leaveRequest.findUnique({ where: { id: requestId } });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }
    
    if (request.employeeId !== employee.id && employee.user?.role?.name !== 'HR' && employee.user?.role?.name !== 'CEO' && employee.user?.role?.name !== 'MANAGER') {
      throw new ForbiddenException('You do not have permission to update this leave request');
    }
    
    if (request.status !== 'Pending' && request.status !== 'Waiting CEO') {
      throw new ForbiddenException('Can only update pending leave requests');
    }

    const dataToUpdate: any = { ...dto };
    
    let newStartDate: Date;
    let newEndDate: Date;

    if (dto.leaveMode) {
      if (dto.leaveMode === 'hourly' && dto.leaveDate && dto.startTime && dto.endTime) {
        newStartDate = new Date(dto.leaveDate + 'T' + dto.startTime + ':00');
        newEndDate = new Date(dto.leaveDate + 'T' + dto.endTime + ':00');
        
        if (newEndDate <= newStartDate) {
          throw new BadRequestException('End time must be after start time');
        }
        
        const diffMs = newEndDate.getTime() - newStartDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        dto.startFormat = 'hourly';
        dto.endFormat = 'hourly';
        dto.leaveHours = diffHours;
      } else if ((dto.leaveMode === 'full_day' || dto.leaveMode === 'half_day') && dto.startDate && dto.endDate) {
        newStartDate = new Date(dto.startDate);
        newEndDate = new Date(dto.endDate);
        if (dto.period && dto.leaveMode === 'half_day') {
          dto.startFormat = dto.period;
          dto.endFormat = dto.period;
        } else {
          dto.startFormat = 'full';
          dto.endFormat = 'full';
        }
      } else {
        throw new BadRequestException('Incomplete data for the selected leave mode');
      }
    } else {
      newStartDate = dto.startDate ? new Date(dto.startDate) : request.startDate;
      newEndDate = dto.endDate ? new Date(dto.endDate) : request.endDate;
    }
    
    if (dto.startDate || dto.endDate || dto.leaveMode) {
      if (newStartDate > newEndDate) {
        throw new BadRequestException('Start date must be before or equal to end date');
      }

      const holidays = await this.prisma.publicHoliday.findMany({
        where: {
          date: {
            gte: newStartDate,
            lte: newEndDate,
          }
        }
      });

      const currentYear = new Date().getFullYear();
      const balance = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employee.id,
            leaveTypeId: request.leaveTypeId,
            year: currentYear,
          }
        },
        include: {
          leaveType: true,
        }
      });

      if (!balance) {
        throw new BadRequestException('Leave balance not found');
      }

      const advanceNoticeDays = (balance.leaveType as any)?.advanceNoticeDays || 0;
      if (advanceNoticeDays > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const startDay = new Date(newStartDate);
        startDay.setHours(0, 0, 0, 0);

        const diffTime = startDay.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < advanceNoticeDays) {
          throw new BadRequestException(`ต้องยื่นล่วงหน้าอย่างน้อย ${advanceNoticeDays} วัน (Requires ${advanceNoticeDays} days advance notice)`);
        }
      }

      const minTenureDays = (balance.leaveType as any)?.minTenureDays || 0;
      if (minTenureDays > 0) {
        const joinDate = new Date(employee.hireDate);
        const diffTime = newStartDate.getTime() - joinDate.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < minTenureDays) {
          throw new BadRequestException(`ต้องมีอายุงานอย่างน้อย ${minTenureDays} วัน (Requires at least ${minTenureDays} days of tenure)`);
        }
      }

      const leaveTypeName = balance.leaveType.name;
      const isMaternityFemale = leaveTypeName.includes('คลอดบุตร') && employee.gender === 'Female';

      const calculatedDays = this.calculateWorkingDays(newStartDate, newEndDate, holidays.map(h => h.date), dto.startFormat || request.startFormat, dto.endFormat || request.endFormat, isMaternityFemale, dto.leaveHours);
      if (calculatedDays <= 0) {
        console.error('Leave duration calculation failed:', {
          newStartDate, newEndDate, calculatedDays, dto, request
        });
        throw new BadRequestException('Leave duration must be greater than 0');
      }
      
      const pendingLeave = await this.prisma.leaveRequest.aggregate({
        where: {
          employeeId: employee.id,
          leaveTypeId: request.leaveTypeId,
          status: { in: ['Pending', 'Waiting CEO'] },
          startDate: { gte: new Date(`${currentYear}-01-01T00:00:00.000Z`) },
          id: { not: requestId }
        },
        _sum: { totalDays: true }
      });
      const pendingDays = pendingLeave._sum.totalDays || 0;
      const effectiveRemainingDays = balance.remainingDays - pendingDays;

      let paidDays = calculatedDays;
      let unpaidDays = 0;

      // 1. ลาป่วย
      if (leaveTypeName === 'ลาป่วย') {
        const prev = await this.prisma.leaveRequest.aggregate({
          where: { 
            employeeId: employee.id, 
            leaveTypeId: request.leaveTypeId, 
            status: { notIn: ['Rejected', 'Cancelled'] },
            startDate: { gte: new Date(`${currentYear}-01-01`) },
            id: { not: requestId }
          },
          _sum: { paidDays: true }
        });
        const usedPaid = prev._sum.paidDays || 0;
        paidDays = Math.min(calculatedDays, Math.max(0, 30 - usedPaid));
        unpaidDays = calculatedDays - paidDays;
      } 
      // 2. ลาเพื่อคลอดบุตร
      else if (leaveTypeName.includes('คลอดบุตร')) {
        if (employee.gender === 'Female') {
          if (calculatedDays > 135) throw new BadRequestException('สิทธิลาเพื่อคลอดบุตร สำหรับพนักงานหญิง ไม่เกิน 120 วัน (และลาเพิ่มได้อีก 15 วันหากมีใบรับรองแพทย์)');
          
          let extraPaid = 0;
          if (calculatedDays > 120) {
             extraPaid = (calculatedDays - 120) * 0.5;
          }
          paidDays = Math.min(calculatedDays, 60) + extraPaid;
          unpaidDays = calculatedDays - paidDays;
        } else if (employee.gender === 'Male') {
          if (calculatedDays > 15) throw new BadRequestException('สิทธิลาเพื่อช่วยเหลือภริยาคลอดบุตร สำหรับพนักงานชาย ไม่เกิน 15 วัน');
          paidDays = calculatedDays;
          unpaidDays = 0;
        }
      }
      // 3. ลาเพื่อรับราชการทหาร
      else if (leaveTypeName.includes('ทหาร')) {
        const prev = await this.prisma.leaveRequest.aggregate({
          where: { 
            employeeId: employee.id, 
            leaveTypeId: request.leaveTypeId, 
            status: { notIn: ['Rejected', 'Cancelled'] },
            startDate: { gte: new Date(`${currentYear}-01-01`) },
            id: { not: requestId }
          },
          _sum: { paidDays: true }
        });
        const usedPaid = prev._sum.paidDays || 0;
        paidDays = Math.min(calculatedDays, Math.max(0, 60 - usedPaid));
        unpaidDays = calculatedDays - paidDays;
      }
      // 4. ลาพักผ่อนประจำปี (พักร้อน)
      else if (leaveTypeName === 'ลาพักผ่อนประจำปี (พักร้อน)') {
        const msInYear = 1000 * 60 * 60 * 24 * 365;
        const workDurationMs = new Date().getTime() - new Date(employee.hireDate).getTime();
        if (workDurationMs < msInYear) {
          throw new BadRequestException('คุณต้องมีอายุงานครบ 1 ปี จึงจะสามารถใช้สิทธิลาพักผ่อนประจำปีได้');
        }
        if (effectiveRemainingDays < calculatedDays) {
          throw new BadRequestException(`สิทธิวันลาไม่เพียงพอ (เหลือเพียง ${effectiveRemainingDays} วัน)`);
        }
        paidDays = calculatedDays;
      } 
      // 5. ลาเพื่อทำหมัน
      else if (leaveTypeName.includes('ทำหมัน')) {
        paidDays = calculatedDays;
        unpaidDays = 0;
      }
      // Other leaves
      else {
        if (effectiveRemainingDays < calculatedDays) {
          throw new BadRequestException(`สิทธิวันลาไม่เพียงพอ (เหลือเพียง ${effectiveRemainingDays} วัน)`);
        }
        paidDays = calculatedDays;
      }
      
      dataToUpdate.totalDays = calculatedDays;
      dataToUpdate.paidDays = paidDays;
      dataToUpdate.unpaidDays = unpaidDays;
      dataToUpdate.startDate = newStartDate;
      dataToUpdate.endDate = newEndDate;
      dataToUpdate.startFormat = dto.startFormat || request.startFormat;
      dataToUpdate.endFormat = dto.endFormat || request.endFormat;
    }

    delete dataToUpdate.leaveMode;
    delete dataToUpdate.leaveDate;
    delete dataToUpdate.startTime;
    delete dataToUpdate.endTime;
    delete dataToUpdate.hours;
    delete dataToUpdate.period;
    delete dataToUpdate.leaveHours;

    return this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: dataToUpdate,
    });
  }

  async deleteLeaveRequest(userId: string, requestId: string) {
    const employee = await this.getEmployeeByUserId(userId);
    const request = await this.prisma.leaveRequest.findUnique({ where: { id: requestId } });

    if (!request || request.employeeId !== employee.id) {
      throw new NotFoundException('Leave request not found');
    }
    
    if (request.status.includes('Rejected')) {
      throw new ForbiddenException('Cannot delete a rejected leave request');
    }

    if (request.status.includes('Approved')) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDay = new Date(request.startDate);
      startDay.setHours(0, 0, 0, 0);
      if (startDay <= today) {
        throw new ForbiddenException('Cannot cancel an approved leave on or after its start date');
      }
    }

    return this.prisma.$transaction(async (prisma) => {
      if (request.status === 'Waiting CEO' || request.status.includes('Approved')) {
        const currentYear = new Date(request.startDate).getFullYear();
        const leaveBalance = await prisma.leaveBalance.findFirst({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: currentYear
          }
        });

        if (leaveBalance) {
          const newUsedDays = leaveBalance.usedDays - request.totalDays;
          const newRemainingDays = leaveBalance.totalDays - newUsedDays;

          await prisma.leaveBalance.update({
            where: { id: leaveBalance.id },
            data: {
              usedDays: newUsedDays,
              remainingDays: newRemainingDays
            }
          });
        }
      }
      
      // Change status to Cancelled instead of deleting in all cases to preserve history
      return prisma.leaveRequest.update({ 
        where: { id: requestId },
        data: { status: 'Cancelled' }
      });
    });
  }

  async getMe(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: {
        department: { select: { name: true } },
        position: { select: { name: true } },
        user: { 
          select: { 
            email: true,
            avatarUrl: true,
            role: { select: { name: true } }
          } 
        }
      }
    });
    
    if (!employee) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true }
      });
      if (!user) throw new NotFoundException('User not found');
      return user;
    }
    
    return employee;
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    const oldUser = await this.prisma.user.findUnique({ where: { id: userId } });
    
    if (oldUser?.avatarUrl && oldUser.avatarUrl !== avatarUrl) {
      try {
        const relativePath = oldUser.avatarUrl.startsWith('/') ? oldUser.avatarUrl.substring(1) : oldUser.avatarUrl;
        const filePath = path.join(process.cwd(), relativePath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error('Failed to delete old avatar:', err);
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    return { success: true, message: 'Avatar updated successfully', avatarUrl: user.avatarUrl };
  }

  async getLeaveHistory(userId: string) {
    const employee = await this.getEmployeeByUserId(userId);
    return this.prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      include: {
        leaveType: true,
        attachments: true,
        employee: { 
          select: { 
            id: true,
            employeeCode: true,
            title: true,
            firstName: true, 
            lastName: true,
            department: { select: { name: true } },
            position: { select: { name: true } },
            user: { select: { id: true, avatarUrl: true, role: { select: { name: true } } } }
          } 
        },
        approvals: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
  }

  async getDepartmentLeaves(userId: string) {
    const employee = await this.getEmployeeByUserId(userId);
    if (!employee.departmentId) return [];

    return this.prisma.leaveRequest.findMany({
      where: { 
        employee: { departmentId: employee.departmentId } 
      },
      orderBy: { createdAt: 'desc' },
      include: {
        leaveType: true,
        attachments: true,
        employee: { 
          select: { 
            id: true,
            employeeCode: true,
            title: true,
            firstName: true, 
            lastName: true,
            department: { select: { name: true } },
            position: { select: { name: true } },
            user: { select: { id: true, avatarUrl: true, role: { select: { name: true } } } }
          } 
        },
        approvals: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
  }

  async getAllCompanyLeaves() {
    return this.prisma.leaveRequest.findMany({
      where: {
        status: { contains: 'Approved' } // Only show approved leaves for the whole company calendar
      },
      orderBy: { createdAt: 'desc' },
      include: {
        leaveType: true,
        attachments: true,
        employee: { 
          select: { 
            id: true,
            employeeCode: true,
            title: true,
            firstName: true, 
            lastName: true,
            department: { select: { name: true } },
            position: { select: { name: true } },
            user: { select: { id: true, avatarUrl: true, role: { select: { name: true } } } }
          } 
        },
        approvals: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
  }

  async getLeaveBalance(userId: string) {
    const employee = await this.getEmployeeByUserId(userId);
    const currentYear = new Date().getFullYear();
    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId: employee.id, year: currentYear },
      include: { leaveType: true }
    });

    const pendingLeaves = await this.prisma.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      where: {
        employeeId: employee.id,
        status: { in: ['Pending', 'Waiting CEO'] },
        startDate: { gte: new Date(`${currentYear}-01-01T00:00:00.000Z`) }
      },
      _sum: { totalDays: true }
    });

    const pendingMap: Record<string, number> = {};
    pendingLeaves.forEach(p => {
      pendingMap[p.leaveTypeId] = p._sum.totalDays || 0;
    });

    return balances.map(balance => {
      const pendingDays = pendingMap[balance.leaveTypeId] || 0;
      return {
        ...balance,
        pendingDays,
        effectiveRemainingDays: balance.remainingDays - pendingDays,
        employeeHireDate: employee.hireDate
      };
    });
  }

  async getDashboardStats(userId: string, targetYear?: number) {
    const employee = await this.getEmployeeByUserId(userId);
    const currentYear = targetYear || new Date().getFullYear();

    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId: employee.id, year: currentYear },
      include: { leaveType: true }
    });
    
    const vacationBalance = balances.find(b => b.leaveType?.name.includes('พักร้อน') || b.leaveType?.name.includes('พักผ่อน'));
    const remainingVacation = vacationBalance?.remainingDays || 0;

    const pendingApprovals = await this.prisma.leaveRequest.count({
      where: {
        employeeId: employee.id,
        status: { in: ['Pending', 'Waiting CEO'] }
      }
    });

    const approvedThisYear = await this.prisma.leaveRequest.count({
      where: {
        employeeId: employee.id,
        status: { contains: 'Approved' },
        startDate: {
          gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
          lt: new Date(`${currentYear + 1}-01-01T00:00:00.000Z`)
        }
      }
    });

    const rejectedRequests = await this.prisma.leaveRequest.count({
      where: {
        employeeId: employee.id,
        status: { contains: 'Rejected' }
      }
    });

    const approvedLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: { contains: 'Approved' },
        startDate: {
          gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
          lt: new Date(`${currentYear + 1}-01-01T00:00:00.000Z`)
        }
      }
    });

    const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const chartData = monthNames.map(name => ({ name, value: 0 }));

    approvedLeaves.forEach(leave => {
      const monthIndex = new Date(leave.startDate).getMonth();
      chartData[monthIndex].value += leave.totalDays;
    });

    const announcements = await this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    const recentLeaves = await this.prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: { leaveType: true }
    });

    const activities = recentLeaves.map(r => {
      let color = "bg-orange-400";
      let statusText = "ส่งคำขอแล้ว";
      if (r.status.includes("Approved")) {
          color = "bg-emerald-400";
          statusText = "อนุมัติแล้ว";
      } else if (r.status.includes("Rejected")) {
          color = "bg-red-400";
          statusText = "ถูกปฏิเสธ";
      }
      return {
        title: `${r.leaveType.name} - ${statusText}`,
        time: r.createdAt.toISOString(),
        color
      };
    });

    return {
      remainingVacation,
      pendingApprovals,
      approvedThisYear,
      rejectedRequests,
      chartData,
      announcements,
      activities,
      employeeName: `${employee.firstName} ${employee.lastName}`
    };
  }

  async getLeaveTypes() {
    return this.prisma.leaveType.findMany({
      orderBy: { name: 'asc' }
    });
  }

  private async getEmployeeByUserId(userId: string) {
    const employee = await this.prisma.employee.findUnique({ 
      where: { userId },
      include: { user: { include: { role: true } } }
    });
    if (!employee) throw new NotFoundException('Employee profile not found');
    return employee;
  }

  private calculateWorkingDays(startDate: Date, endDate: Date, holidays: Date[], startFormat: string = 'full', endFormat: string = 'full', includeHolidaysAndWeekends: boolean = false, leaveHours: number = 0): number {
    let count = 0;
    const curDate = new Date(startDate);
    curDate.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    const holidayTimes = new Set(holidays.map(h => {
      const d = new Date(h);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }));

    while (curDate <= end) {
      const dayOfWeek = curDate.getDay();
      if (includeHolidaysAndWeekends) {
        count++;
      } else {
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          if (!holidayTimes.has(curDate.getTime())) {
            count++;
          }
        }
      }
      curDate.setDate(curDate.getDate() + 1);
    }
    
    if (count > 0) {
      if (startFormat === 'morning' || startFormat === 'afternoon') {
        count -= 0.5;
      } else if (startFormat === 'hourly' && leaveHours > 0) {
        count -= (1 - (leaveHours / 8));
      }
      
      const isSameDay = startDate.getFullYear() === endDate.getFullYear() && 
                        startDate.getMonth() === endDate.getMonth() && 
                        startDate.getDate() === endDate.getDate();

      if (!isSameDay && (endFormat === 'morning' || endFormat === 'afternoon')) {
        count -= 0.5;
      } else if (!isSameDay && endFormat === 'hourly' && leaveHours > 0) {
        count -= (1 - (leaveHours / 8));
      }
    }
    
    return count;
  }

  async getPublicHolidays() {
    const holidays = await this.prisma.publicHoliday.findMany({
      orderBy: { date: 'asc' }
    });
    return {
      success: true,
      data: holidays
    };
  }
}
