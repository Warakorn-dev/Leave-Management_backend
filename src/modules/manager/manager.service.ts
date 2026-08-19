import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProcessLeaveRequestDto } from './dto/manager.dto';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ManagerService {
  constructor(private prisma: PrismaService, private notificationService: NotificationService) {}

  async getPendingRequests(userId: string) {
    const manager = await this.getEmployeeByUserId(userId);
    return this.prisma.leaveRequest.findMany({
      where: {
        status: 'PENDING_SUPERVISOR',
        employee: {
          departmentId: manager.departmentId,
          id: { not: manager.id } // Exclude manager's own leaves
        }
      },
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
            user: { select: { role: { select: { name: true } } } }
          } 
        },
        leaveType: true,
        attachments: true,
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getDepartmentHistory(managerUserId: string) {
    const manager = await this.getEmployeeByUserId(managerUserId);
    
    // Get all requests (including Approved/Rejected) from employees in the same department
    return this.prisma.leaveRequest.findMany({
      where: {
        employee: {
          departmentId: manager.departmentId,
          id: { not: manager.id } // Exclude manager's own leaves
        }
      },
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
            user: { select: { id: true, avatarUrl: true, role: { select: { name: true } } } }
          } 
        },
        leaveType: true,
        attachments: true,
        approvals: {
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async processRequest(managerUserId: string, requestId: string, action: 'Approve' | 'Reject', dto: ProcessLeaveRequestDto) {
    const manager = await this.getEmployeeByUserId(managerUserId);
    const request = await this.prisma.leaveRequest.findUnique({ 
      where: { id: requestId },
      include: { leaveType: true, employee: true }
    });

    if (!request || request.status !== 'PENDING_SUPERVISOR') {
      throw new BadRequestException('Invalid request or already processed');
    }

    if (action === 'Reject' && !dto.comment?.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    if (request.employee.departmentId !== manager.departmentId) {
      throw new BadRequestException('Employee is not in your department');
    }

    let nextStatus = '';
    if (action === 'Reject') {
      nextStatus = 'REJECTED';
    } else {
      // The leave-type configuration controls the workflow; do not infer it
      // from a Thai display name, which HR can change at any time.
      nextStatus = request.leaveType.isSpecial ? 'PENDING_EXECUTIVE' : 'APPROVED';
    }

    return this.prisma.$transaction(async (prisma) => {
      // 1. Update Request Status
      const updatedRequest = await prisma.leaveRequest.update({
        where: { id: requestId },
        data: { status: nextStatus },
      });

      // 2. Add Approval Log
      await prisma.leaveApproval.create({
        data: {
          leaveRequestId: requestId,
          approverId: managerUserId,
          status: nextStatus,
          comment: dto.comment,
        }
      });

      // 3. Deduct Leave Balance if Manager Approves and status is final APPROVED
      if (nextStatus === 'APPROVED') {
        const currentYear = new Date(request.startDate).getFullYear();
        const leaveBalance = await prisma.leaveBalance.findFirst({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: currentYear
          }
        });

        if (leaveBalance) {
          // Use the available balance directly because HR can adjust it
          // manually; usedDays may otherwise be out of sync.
          const newRemainingDays = leaveBalance.remainingDays - request.totalDays;

          if (newRemainingDays < 0) {
            throw new BadRequestException('Insufficient leave balance');
          }

          const newUsedDays = leaveBalance.totalDays - newRemainingDays;

          await prisma.leaveBalance.update({
            where: { id: leaveBalance.id },
            data: {
              usedDays: newUsedDays,
              remainingDays: newRemainingDays
            }
          });
        }
      }

      return updatedRequest;
    }).then(async (updatedRequest) => {
      try {
        const employeeUser = await this.prisma.user.findUnique({ where: { id: request.employee.userId } });
        const statusText = nextStatus.includes('APPROVED') ? 'อนุมัติ' : (nextStatus === 'PENDING_EXECUTIVE' ? 'ส่งต่อให้ผู้บริหารพิจารณา' : 'ปฏิเสธ');

        if (employeeUser?.id) {
          await this.prisma.notification.create({
            data: {
              userId: employeeUser.id,
              title: statusText === 'ปฏิเสธ' ? 'คำขอลาถูกปฏิเสธโดย Manager' : 'ความคืบหน้าคำขอลาของคุณ',
              message: statusText === 'ส่งต่อให้ผู้บริหารพิจารณา' ? `คำขอ${request.leaveType.name} ของคุณได้รับการตรวจสอบโดยผู้จัดการแล้ว กำลังรอผู้บริหารอนุมัติ` : `คำขอ${request.leaveType.name} ของคุณได้รับการ${statusText}โดยผู้จัดการแผนกเรียบร้อยแล้ว`,
              type: statusText === 'ปฏิเสธ' ? 'REJECT' : (statusText === 'อนุมัติ' ? 'APPROVE' : 'SYSTEM'),
              redirectUrl: '/dashboard/user/history',
            }
          });
        }

        if (employeeUser?.email) {
          this.notificationService.sendEmail(
            employeeUser.email,
            `[Leave Request] ความคืบหน้าคำขอลางานของคุณ`,
            `เรียน ${request.employee.firstName},\n\nคำขอลา${request.leaveType.name} ของคุณ (วันที่ ${request.startDate.toLocaleDateString()} ถึง ${request.endDate.toLocaleDateString()}) ${statusText === 'ส่งต่อให้ผู้บริหารพิจารณา' ? 'กำลังรอการอนุมัติจากผู้บริหาร' : `ได้ถูก${statusText}โดยหัวหน้างานแล้ว`}\nหมายเหตุ: ${dto.comment || '-'}\n\nคุณสามารถตรวจสอบสถานะได้ในระบบ`
          );
        }

        // --- Add HR Notifications ---
        const hrs = await this.prisma.user.findMany({
          where: { role: { name: 'HR' } }
        });
        for (const hr of hrs) {
          if (hr.id) {
            await this.prisma.notification.create({
              data: {
                userId: hr.id,
                title: 'การตรวจสอบคำขอลาโดยผู้จัดการ',
                message: `คำขอลา ${request.leaveType.name} ของ "${request.employee.firstName} ${request.employee.lastName}" ได้ถูก${statusText}โดยหัวหน้างานแล้ว`,
                type: 'SYSTEM',
                redirectUrl: '/dashboard/hr/leave-history',
              }
            });
          }
          if (hr.email) {
            this.notificationService.sendEmail(
              hr.email,
              `[Leave Request] แจ้งเตือนการตรวจสอบคำขอลาโดยผู้จัดการ`,
              `เรียนฝ่ายบุคคล (HR),\n\nคำขอลา${request.leaveType.name} ของ ${request.employee.firstName} ${request.employee.lastName} ได้ถูก${statusText}โดยหัวหน้างานแล้ว\nหมายเหตุ: ${dto.comment || '-'}\n\nคุณสามารถตรวจสอบรายละเอียดได้ในระบบ`
            );
          }
        }
        // ----------------------------
        
        if (nextStatus === 'PENDING_EXECUTIVE') {
          const ceos = await this.prisma.user.findMany({
            where: { role: { name: 'CEO' } }
          });
          for (const ceo of ceos) {
            if (ceo.id) {
              await this.prisma.notification.create({
                data: {
                  userId: ceo.id,
                  title: 'มีคำขอลาจากผู้จัดการแผนกส่งต่อมา',
                  message: `ผู้จัดการได้ส่งต่อคำขอ ${request.leaveType.name} ของ "${request.employee.firstName} ${request.employee.lastName}"`,
                  type: 'NEW_ORDER',
                  redirectUrl: '/dashboard/ceo/approval',
                }
              });
            }
            if (ceo.email) {
              this.notificationService.sendEmail(
                ceo.email,
                `[Leave Request] คำขอลาพักผ่อนส่งต่อจากผู้จัดการ`,
                `เรียน CEO,\n\n${request.employee.firstName} ${request.employee.lastName} ได้ยื่นคำขอลาพักผ่อน ซึ่งผ่านการตรวจสอบจากหัวหน้างานแล้ว\nกรุณาเข้าสู่ระบบเพื่ออนุมัติ`
              );
            }
          }
        }
      } catch (e) {
        console.error('Failed to send manager notification', e);
      }
      return updatedRequest;
    });
  }

  private async getEmployeeByUserId(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { position: true, user: { include: { role: true } } },
    });
    if (!employee) throw new NotFoundException('Manager profile not found');

    const roleName = employee.user?.role?.name;
    if (roleName === 'HR') {
      const posName = employee.position?.name || '';
      const isLeader = posName.toLowerCase().includes('leader') || posName.toLowerCase().includes('manager');
      if (!isLeader) {
        throw new ForbiddenException('Only HR department heads can access manager approval functions');
      }
    }
    return employee;
  }

  async getDashboardStats(userId: string, targetYear?: number) {
    const manager = await this.getEmployeeByUserId(userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const currentYear = targetYear || today.getFullYear();

    const [totalEmployees, pendingRequests, announcements, activities] = await Promise.all([
      this.prisma.employee.count({
        where: { departmentId: manager.departmentId }
      }),
      this.prisma.leaveRequest.count({ 
        where: { 
          status: 'PENDING_SUPERVISOR',
          employee: { departmentId: manager.departmentId }
        } 
      }),
      this.prisma.announcement.findMany({ take: 2, orderBy: { createdAt: 'desc' } }),
      this.prisma.leaveRequest.findMany({ 
        where: { employee: { departmentId: manager.departmentId } },
        take: 3, 
        orderBy: { createdAt: 'desc' },
        include: { leaveType: true, employee: true }
      })
    ]);

    const leavesTodayCount = await this.prisma.leaveRequest.count({
      where: {
        status: 'APPROVED',
        startDate: { lte: tomorrow },
        endDate: { gte: today },
        employee: { departmentId: manager.departmentId }
      }
    });

    const monthlyStatsRaw = await this.prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: {
          gte: new Date(`${currentYear}-01-01`),
          lt: new Date(`${currentYear + 1}-01-01`)
        },
        employee: { departmentId: manager.departmentId }
      },
      select: { startDate: true }
    });

    const monthlyCounts = Array(12).fill(0);
    monthlyStatsRaw.forEach(req => {
      monthlyCounts[new Date(req.startDate).getMonth()]++;
    });
    
    const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const monthlyStats = monthNames.map((month, index) => ({
      month,
      value: monthlyCounts[index]
    }));

    return {
      stats: {
        totalEmployees,
        leavesToday: leavesTodayCount,
        remainingEmployees: totalEmployees > leavesTodayCount ? totalEmployees - leavesTodayCount : 0,
        leaveQuotaToday: 1, // You might compute this from business rules
        pendingApprovals: pendingRequests,
      },
      monthlyStats,
      announcements: announcements.map(a => ({
        id: a.id,
        title: a.title,
        subtitle: a.subtitle || '...',
        isImportant: a.isImportant
      })),
      activities: activities.map(req => {
        let type = 'leave';
        let title = `${req.employee?.firstName || 'พนักงาน'} ส่งคำขอลา${req.leaveType?.name || 'ลา'} ${req.totalDays || 1} วัน`;
        if (req.status?.toUpperCase() === 'APPROVED') {
          type = 'approve';
          title = `หัวหน้าอนุมัติการลาของ ${req.employee?.firstName || 'พนักงาน'}`;
        }
        return {
          id: req.id,
          title,
          time: new Date(req.createdAt).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' }),
          type
        };
      })
    };
  }
}
