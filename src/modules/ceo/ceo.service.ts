import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class CeoService {
  constructor(private prisma: PrismaService, private notificationService: NotificationService) {}

  async getDashboardStats(userId: string, targetYear?: number) {
    const totalEmployees = await this.prisma.employee.count({
      where: { user: { role: { name: { not: 'CEO' } } } }
    });
    const totalLeaves = await this.prisma.leaveRequest.count();
    
    // Calculate pending leaves (across all levels to show overall pending load)
    const pendingLeaves = await this.prisma.leaveRequest.count({ 
      where: { status: { in: ['Pending', 'Waiting Manager', 'Waiting CEO'] } } 
    });
    
    const approvedLeaves = await this.prisma.leaveRequest.count({ where: { status: 'Approved' } });
    const rejectedLeaves = await this.prisma.leaveRequest.count({ where: { status: 'Rejected' } });

    // Calculate leaves today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const leavesToday = await this.prisma.leaveRequest.count({
      where: {
        status: 'Approved',
        startDate: { lte: today },
        endDate: { gte: today }
      }
    });

    // Chart Data (Leaves per month this year)
    const currentYear = targetYear || new Date().getFullYear();
    const leavesThisYear = await this.prisma.leaveRequest.findMany({
      where: {
        startDate: {
          gte: new Date(`${currentYear}-01-01`),
          lte: new Date(`${currentYear}-12-31`),
        }
      },
      select: { startDate: true, employeeId: true }
    });

    const monthlyEmployeeSets = Array.from({ length: 12 }, () => new Set<string>());
    leavesThisYear.forEach(leave => {
      const month = leave.startDate.getMonth();
      monthlyEmployeeSets[month].add(leave.employeeId);
    });
    
    const monthlyStats = monthlyEmployeeSets.map(set => set.size);

    // Personal stats for CEO
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { 
        leaveBalances: { include: { leaveType: true } }, 
        leaveRequests: true 
      }
    });

    let remainingVacation = 0;
    let personalPending = 0;
    let personalApproved = 0;
    let personalRejected = 0;

    if (employee) {
      const vacationBalance = employee.leaveBalances.find(b => b.leaveType.name === 'ลาพักร้อน');
      remainingVacation = vacationBalance?.remainingDays || 0;

      employee.leaveRequests.forEach(req => {
        if (req.status === 'Pending' || req.status.startsWith('Waiting')) personalPending++;
        else if (req.status === 'Approved') {
          if (new Date(req.startDate).getFullYear() === currentYear) personalApproved++;
        }
        else if (req.status === 'Rejected') personalRejected++;
      });
    }

    const announcements = await this.prisma.announcement.findMany({ take: 2, orderBy: { createdAt: 'desc' } });
    
    const recentLeaves = await this.prisma.leaveRequest.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      include: { employee: true }
    });
    
    const activities = recentLeaves.map(leave => {
      let timeText = 'เมื่อวาน';
      const hours = Math.floor((new Date().getTime() - leave.createdAt.getTime()) / (1000 * 60 * 60));
      if (hours < 24) timeText = `${hours} ชม. ที่แล้ว`;
      
      let action = 'ยื่นคำขอลา';
      let color = 'bg-amber-500';
      if (leave.status === 'Approved') { action = 'อนุมัติแล้ว'; color = 'bg-emerald-500'; }
      if (leave.status === 'Rejected') { action = 'ถูกปฏิเสธ'; color = 'bg-red-500'; }
      if (leave.status === 'Cancelled') { action = 'ยกเลิกคำขอลา'; color = 'bg-slate-500'; }

      const empName = leave.employee?.firstName || 'พนักงาน';
      
      return {
        title: `${empName} - ${action}`,
        time: timeText,
        color
      };
    });

    return {
      success: true,
      data: {
        totalEmployees,
        leavesToday,
        remainingEmployees: totalEmployees - leavesToday,
        totalLeaves,
        pendingLeaves,
        approvedLeaves,
        rejectedLeaves,
        chart: monthlyStats, // Index 0 is Jan, 11 is Dec
        personal: {
          remainingVacation,
          pendingApprovals: personalPending,
          approvedThisYear: personalApproved,
          rejectedRequests: personalRejected
        },
        announcements,
        activities
      }
    };
  }

  async getReportStats() {
    const totalEmployees = await this.prisma.employee.count({
      where: { user: { role: { name: { not: 'CEO' } } } }
    });
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const leavesToday = await this.prisma.leaveRequest.count({
      where: {
        status: 'Approved',
        startDate: { lte: today },
        endDate: { gte: today }
      }
    });

    // Work status for today
    const workStatusData = [
      { name: 'มาทำงาน', value: totalEmployees - leavesToday, color: '#16a34a' },
      { name: 'ลางาน', value: leavesToday, color: '#ef4444' }
    ];

    // Leave Types breakdown for this month
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);

    const leavesThisMonth = await this.prisma.leaveRequest.findMany({
      where: {
        status: 'Approved',
        startDate: { lte: lastDayOfMonth },
        endDate: { gte: firstDayOfMonth }
      },
      include: { leaveType: true }
    });

    const leaveTypeCounts: Record<string, number> = {};
    let totalLeaveRequests = leavesThisMonth.length;
    leavesThisMonth.forEach(leave => {
      const typeName = leave.leaveType.name;
      leaveTypeCounts[typeName] = (leaveTypeCounts[typeName] || 0) + 1;
    });

    const colors = ['#f59e0b', '#16a34a', '#2563eb', '#8b5cf6', '#ec4899'];
    let colorIndex = 0;
    const leaveTypesData = Object.entries(leaveTypeCounts).map(([name, count]) => {
      const percent = totalLeaveRequests > 0 ? Math.round((count / totalLeaveRequests) * 100) : 0;
      const color = colors[colorIndex % colors.length];
      colorIndex++;
      return { name, percent, color };
    });

    // Trend Data (Days of current month)
    const trendDataMap = new Map<number, number>();
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      trendDataMap.set(i, 0);
    }

    leavesThisMonth.forEach(leave => {
      const start = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      
      const loopStart = start < firstDayOfMonth ? firstDayOfMonth : start;
      const loopEnd = end > lastDayOfMonth ? lastDayOfMonth : end;
      
      for (let d = new Date(loopStart); d <= loopEnd; d.setDate(d.getDate() + 1)) {
        const day = d.getDate();
        trendDataMap.set(day, (trendDataMap.get(day) || 0) + 1);
      }
    });

    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const monthStr = thaiMonths[currentMonth];

    const trendData: { day: string; value: number }[] = [];
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      // Sample data every 5 days or if it's the last day for the chart, otherwise it's too dense
      if (i === 1 || i % 5 === 0 || i === lastDayOfMonth.getDate()) {
        trendData.push({
          day: `${i} ${monthStr}`,
          value: trendDataMap.get(i) || 0
        });
      }
    }

    return {
      success: true,
      data: {
        workStatusData,
        leaveTypesData,
        trendData
      }
    };
  }

  async getCompanyReport() {
    return this.prisma.leaveRequest.findMany({
      include: { employee: true, leaveType: true }
    });
  }

  async getDepartmentReport(departmentId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { employee: { departmentId } },
      include: { employee: true, leaveType: true }
    });
  }

  async approveSpecialLeave(ceoUserId: string, requestId: string, action: 'Approve' | 'Reject', comment?: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { leaveType: true, employee: true }
    });

    if (!request || (request.status !== 'Waiting CEO' && request.status !== 'Pending')) {
      throw new BadRequestException('Request is not waiting for CEO approval');
    }

    const nextStatus = action === 'Approve' ? 'Approved' : 'Rejected';

    return this.prisma.$transaction(async (prisma) => {
      const updated = await prisma.leaveRequest.update({
        where: { id: requestId },
        data: { status: nextStatus },
      });

      await prisma.leaveApproval.create({
        data: {
          leaveRequestId: requestId,
          approverId: ceoUserId,
          status: nextStatus,
          comment: comment || '',
        }
      });

      if (action === 'Reject' && request.status === 'Approved') {
        // Only refund if the request was actually fully approved and deducted before
        // (Wait, standard flow doesn't reject already Approved requests here, but just in case)
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
      } else if (action === 'Approve' && (request.status === 'Pending' || request.status === 'Waiting CEO')) {
        const currentYear = new Date(request.startDate).getFullYear();
        const leaveBalance = await prisma.leaveBalance.findFirst({
          where: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: currentYear
          }
        });

        if (leaveBalance) {
          // If the request was already created, the balance was NOT deducted during creation.
          // Wait, is balance deducted during creation?
          // The employee.service.ts createLeaveRequest does NOT deduct balance! It only validates.
          // So we must deduct it here.
          const newUsedDays = leaveBalance.usedDays + request.totalDays;
          const newRemainingDays = leaveBalance.totalDays - newUsedDays;

          if (newRemainingDays < 0) {
            throw new BadRequestException('Insufficient leave balance');
          }

          await prisma.leaveBalance.update({
            where: { id: leaveBalance.id },
            data: {
              usedDays: newUsedDays,
              remainingDays: newRemainingDays
            }
          });
        }
      }

      return updated;
    }).then(async (updatedRequest) => {
      try {
        const employeeUser = await this.prisma.user.findUnique({
          where: { id: request.employee.userId },
          include: { role: true }
        });
        const statusText = nextStatus.includes('Approved') ? 'อนุมัติ' : 'ปฏิเสธ';
        const userRole = employeeUser?.role?.name?.toLowerCase() || 'user';
        const redirectUrl = userRole === 'manager' 
          ? '/dashboard/manager/history'
          : userRole === 'hr'
          ? '/dashboard/hr/leave-history'
          : '/dashboard/user/history';

        if (employeeUser?.id) {
          await this.prisma.notification.create({
            data: {
              userId: employeeUser.id,
              title: statusText === 'อนุมัติ' ? 'คำขอลาได้รับการอนุมัติจาก CEO' : 'คำขอลาถูกปฏิเสธโดย CEO',
              message: `คำขอ${request.leaveType.name} ของคุณได้รับการ${statusText}โดย CEO เรียบร้อยแล้ว`,
              type: statusText === 'อนุมัติ' ? 'APPROVE' : 'REJECT',
              redirectUrl,
            }
          });
        }

        if (employeeUser?.email) {
          this.notificationService.sendEmail(
            employeeUser.email,
            `[Leave Request] คำขอลางานของคุณถูก${statusText}`,
            `เรียน ${request.employee.firstName},\n\nคำขอลา${request.leaveType.name} ของคุณ (วันที่ ${request.startDate.toLocaleDateString()} ถึง ${request.endDate.toLocaleDateString()}) ได้ถูก${statusText}โดย CEO แล้ว\nหมายเหตุ: ${comment || '-'}\n\nคุณสามารถตรวจสอบสถานะได้ในระบบ`
          );
        }
      } catch (e) {
        console.error('Failed to send ceo notification', e);
      }
      return updatedRequest;
    });
  }

  async findAllEmployees() {
    const employees = await this.prisma.employee.findMany({
      include: {
        user: { select: { email: true, username: true, role: { select: { name: true } } } },
        department: true,
        position: true,
      }
    });

    return employees.map((e: any) => ({
      ...e,
      employeeId: e.employeeCode || `EMP-${e.id.substring(0, 5).toUpperCase()}`,
      username: e.user?.username || e.user?.email || '',
      email: e.user?.email || '',
      role: e.user?.role?.name?.toLowerCase() || '',
      departmentName: e.department?.name || '',
      positionTitle: e.position?.name || '',
      positionName: e.position?.name || '',
      status: 'active'
    }));
  }
}
