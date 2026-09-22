import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';

/** HR dashboard stats, company-wide leave summary/report, and the raw leaves list. */
@Injectable()
export class HrDashboardService {
  constructor(private prisma: PrismaService) {}

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
        status: { contains: 'Approved' },
        startDate: { lte: tomorrow },
        endDate: { gte: today },
      },
    });

    const monthlyStatsRaw = await this.prisma.leaveRequest.findMany({
      where: {
        status: { contains: 'Approved' },
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

    const formattedActivities = activities.map((r) => {
      let color = 'bg-orange-400';
      let statusText = 'ส่งคำขอแล้ว';
      if (r.status.includes('Approved')) {
        color = 'bg-emerald-400';
        statusText = 'อนุมัติแล้ว';
      } else if (r.status.includes('Rejected')) {
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
          r.status.includes('Approved') &&
          new Date(r.startDate).getFullYear() === currentYear,
      ).length;
      personalRejected = employee.leaveRequests.filter((r) =>
        r.status.includes('Rejected'),
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

    const employeeWhere: Prisma.EmployeeWhereInput = {};
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
            status: { contains: 'Approved' },
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
}
