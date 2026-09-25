import {
  Injectable,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  buildOccupiedHalves,
  toDayKey,
  BLOCKING_EXCLUDED_STATUSES,
  LeavePortionInput,
  DayHalf,
} from '../leave-portion.util';
import * as fs from 'fs';
import * as path from 'path';

// Raster images only (no SVG, which can carry script).
const SAFE_AVATAR_DATA_URL =
  /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

/** Employee profile, avatar, and every read-only leave view (history, balance, dashboard, availability). */
/** Strip the leave reason from rows shown to colleagues (calendars). */
function withoutPrivateFields<T extends { reason: string | null }>(
  row: T,
): Omit<T, 'reason'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const { reason, ...rest } = row;
  return rest;
}

@Injectable()
export class EmployeeQueryService {
  constructor(private prisma: PrismaService) {}

  /** Map Prisma leave rows (optionally with their `days` breakdown) to the
   *  plain shape the portion-planning helpers work with. */
  private toPortionInputs(
    rows: {
      startDate: Date;
      endDate: Date;
      startFormat?: string | null;
      endFormat?: string | null;
      days?: { date: Date; portion: string }[];
    }[],
  ): LeavePortionInput[] {
    return rows.map((r) => ({
      startDate: r.startDate,
      endDate: r.endDate,
      startFormat: r.startFormat,
      endFormat: r.endFormat,
      days: r.days?.map((d) => ({
        date: d.date,
        portion:
          d.portion === 'morning' || d.portion === 'afternoon'
            ? d.portion
            : 'full',
      })),
    }));
  }

  private async getEmployeeByUserId(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { user: { include: { role: true } } },
    });
    if (!employee) throw new NotFoundException('Employee profile not found');
    return employee;
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
            role: { select: { name: true } },
          },
        },
      },
    });

    if (!employee) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });
      if (!user) throw new NotFoundException('User not found');
      return user;
    }

    return employee;
  }

  async updateAvatar(userId: string, avatarUrl: string | null) {
    // Security: only a PNG/JPEG/WebP/GIF data URL (or empty = remove the
    // photo) is accepted. The value used to be stored as-is, and a later update
    // then deleted "the old avatar file" at that path — so a user could make
    // the server delete ANY file (e.g. "../.env").
    if (avatarUrl && !SAFE_AVATAR_DATA_URL.test(avatarUrl)) {
      throw new BadRequestException(
        'รูปภาพโปรไฟล์ต้องเป็นไฟล์ JPEG, PNG, WebP หรือ GIF เท่านั้น',
      );
    }

    // Base64 is ~33% larger than binary. A 2MB file is roughly 2.8MB in Base64.
    if (avatarUrl && avatarUrl.length > 2.8 * 1024 * 1024) {
      throw new PayloadTooLargeException(
        'ขนาดไฟล์รูปภาพใหญ่เกินขีดจำกัด (สูงสุดไม่เกิน 2 MB)',
      );
    }

    const oldUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (oldUser?.avatarUrl && oldUser.avatarUrl !== avatarUrl) {
      // Legacy avatars stored as files: delete only a file that really lives
      // inside ./uploads (never follow "../" or absolute paths elsewhere).
      if (
        !oldUser.avatarUrl.startsWith('data:') &&
        !oldUser.avatarUrl.startsWith('http')
      ) {
        try {
          const uploadsDir = path.resolve(process.cwd(), 'uploads');
          const relativePath = oldUser.avatarUrl.replace(/^\/+/, '');
          const filePath = path.resolve(process.cwd(), relativePath);
          if (
            filePath.startsWith(uploadsDir + path.sep) &&
            fs.existsSync(filePath)
          ) {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          console.error('Failed to delete old avatar:', err);
        }
      }
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl },
      });
      return {
        success: true,
        message: 'Avatar updated successfully',
        avatarUrl: user.avatarUrl,
      };
    } catch (error) {
      console.error('Prisma update error in updateAvatar:', error);
      const err = error as { message?: string; code?: string };
      if (
        err.message?.includes('Server has closed the connection') ||
        err.code === 'P2000' ||
        err.message?.includes('too long') ||
        err.message?.includes('packet')
      ) {
        throw new PayloadTooLargeException(
          'ขนาดไฟล์รูปภาพใหญ่เกินกว่าที่ฐานข้อมูลจะรองรับได้ (แนะนำขนาดไม่เกิน 2 MB)',
        );
      }
      throw new BadRequestException(
        'เกิดข้อผิดพลาดในการอัปเดตรูปภาพ กรุณาลองใหม่อีกครั้ง',
      );
    }
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
            user: {
              select: {
                id: true,
                avatarUrl: true,
                role: { select: { name: true } },
              },
            },
          },
        },
        approvals: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async getDepartmentLeaves(userId: string) {
    const employee = await this.getEmployeeByUserId(userId);
    if (!employee.departmentId) return [];

    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        employee: { departmentId: employee.departmentId },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        leaveType: true,
        // Privacy: no attachments, approvals (approver comments) or reason —
        // colleagues must not see them. Owners get them via /leave/history.
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
      },
    });
    return rows.map(withoutPrivateFields);
  }

  async getAllCompanyLeaves() {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        OR: [{ status: 'APPROVED' }, { status: 'Approved' }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        leaveType: true,
        // Privacy: no attachments, approvals (approver comments) or reason —
        // colleagues must not see them. Owners get them via /leave/history.
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
      },
    });
    return rows.map(withoutPrivateFields);
  }

  async getLeaveBalance(userId: string) {
    const employee = await this.getEmployeeByUserId(userId);
    const currentYear = new Date().getFullYear();
    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId: employee.id, year: currentYear },
      include: { leaveType: true },
    });

    const pendingLeaves = await this.prisma.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      where: {
        employeeId: employee.id,
        status: {
          in: [
            'PENDING_VERIFY',
            'REVIEWING_HR',
            'PENDING_SUPERVISOR',
            'PENDING_EXECUTIVE',
          ],
        },
        startDate: { gte: new Date(`${currentYear}-01-01T00:00:00.000Z`) },
      },
      _sum: { totalDays: true },
    });

    const pendingMap: Record<string, number> = {};
    pendingLeaves.forEach((p) => {
      pendingMap[p.leaveTypeId] = p._sum.totalDays || 0;
    });

    return balances.map((balance) => {
      const pendingDays = pendingMap[balance.leaveTypeId] || 0;
      return {
        ...balance,
        pendingDays,
        effectiveRemainingDays: balance.remainingDays - pendingDays,
        employeeHireDate: employee.hireDate,
      };
    });
  }

  async getDashboardStats(userId: string, targetYear?: number) {
    const employee = await this.getEmployeeByUserId(userId);
    const currentYear = targetYear || new Date().getFullYear();

    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId: employee.id, year: currentYear },
      include: { leaveType: true },
    });

    const vacationBalance = balances.find(
      (b) =>
        b.leaveType?.name.includes('พักร้อน') ||
        b.leaveType?.name.includes('พักผ่อน'),
    );
    const remainingVacation = vacationBalance?.remainingDays || 0;

    const pendingApprovals = await this.prisma.leaveRequest.count({
      where: {
        employeeId: employee.id,
        status: {
          in: [
            'PENDING_VERIFY',
            'REVIEWING_HR',
            'PENDING_SUPERVISOR',
            'PENDING_EXECUTIVE',
          ],
        },
      },
    });

    const approvedThisYear = await this.prisma.leaveRequest.count({
      where: {
        employeeId: employee.id,
        status: { contains: 'Approved' },
        startDate: {
          gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
          lt: new Date(`${currentYear + 1}-01-01T00:00:00.000Z`),
        },
      },
    });

    const rejectedRequests = await this.prisma.leaveRequest.count({
      where: {
        employeeId: employee.id,
        status: { contains: 'Rejected' },
      },
    });

    const approvedLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: { contains: 'Approved' },
        startDate: {
          gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
          lt: new Date(`${currentYear + 1}-01-01T00:00:00.000Z`),
        },
      },
    });

    const monthNames = [
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
    const chartData = monthNames.map((name) => ({ name, value: 0 }));

    approvedLeaves.forEach((leave) => {
      const monthIndex = new Date(leave.startDate).getMonth();
      chartData[monthIndex].value += leave.totalDays;
    });

    const announcements = await this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const recentLeaves = await this.prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: { leaveType: true },
    });

    const activities = recentLeaves.map((r) => {
      let color = 'bg-orange-400';
      let statusText = 'ส่งคำขอแล้ว';
      if (r.status.includes('Approved')) {
        color = 'bg-emerald-400';
        statusText = 'อนุมัติแล้ว';
      } else if (r.status.includes('Rejected')) {
        color = 'bg-red-400';
        statusText = 'ไม่อนุมัติ';
      }
      return {
        title: `${r.leaveType.name} - ${statusText}`,
        time: r.createdAt.toISOString(),
        color,
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
      employeeName: `${employee.firstName} ${employee.lastName}`,
    };
  }

  async getLeaveTypes() {
    return this.prisma.leaveType.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async getPublicHolidays() {
    const holidays = await this.prisma.publicHoliday.findMany({
      orderBy: { date: 'asc' },
    });
    return {
      success: true,
      data: holidays,
    };
  }

  /**
   * Per-day leave availability for the current employee across [startDate,
   * endDate]. Used by the request / edit screens to show, for every day, which
   * half is already booked and which half is still free — instead of blindly
   * blocking a whole day. `excludeRequestId` drops the row being edited so it
   * does not count against itself.
   */
  async getDayAvailability(
    userId: string,
    startDateStr: string,
    endDateStr: string,
    excludeRequestId?: string,
  ) {
    const employee = await this.getEmployeeByUserId(userId);

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('ช่วงวันที่ไม่ถูกต้อง');
    }
    if (start > end) {
      throw new BadRequestException('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
    }

    const rangeStart = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    );
    const rangeEnd = new Date(
      Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth(),
        end.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    const spanDays =
      Math.round(
        (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;
    if (spanDays > 366) {
      throw new BadRequestException('ช่วงวันที่กว้างเกินไป');
    }

    const [existing, holidays] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          employeeId: employee.id,
          status: { notIn: BLOCKING_EXCLUDED_STATUSES },
          startDate: { lte: rangeEnd },
          endDate: { gte: rangeStart },
          ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
        },
        select: {
          startDate: true,
          endDate: true,
          startFormat: true,
          endFormat: true,
          days: { select: { date: true, portion: true } },
          leaveType: { select: { name: true } },
        },
      }),
      this.prisma.publicHoliday.findMany({
        where: { date: { gte: rangeStart, lte: rangeEnd } },
      }),
    ]);

    const occupied = buildOccupiedHalves(this.toPortionInputs(existing));
    const holidaySet = new Set(holidays.map((h) => toDayKey(h.date)));

    const days: Array<{
      date: string;
      isWeekend: boolean;
      isHoliday: boolean;
      takenHalves: DayHalf[];
      morningTaken: boolean;
      afternoonTaken: boolean;
      status: 'available' | 'partial' | 'full' | 'holiday';
    }> = [];

    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      const key = toDayKey(cursor);
      const weekday = cursor.getUTCDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const isHoliday = holidaySet.has(key);
      const taken = occupied.get(key) ?? new Set<DayHalf>();
      const morningTaken = taken.has('morning');
      const afternoonTaken = taken.has('afternoon');

      let status: 'available' | 'partial' | 'full' | 'holiday' = 'available';
      if (isWeekend || isHoliday) status = 'holiday';
      else if (morningTaken && afternoonTaken) status = 'full';
      else if (morningTaken || afternoonTaken) status = 'partial';

      days.push({
        date: key,
        isWeekend,
        isHoliday,
        takenHalves: [...taken].sort(),
        morningTaken,
        afternoonTaken,
        status,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { success: true, data: days };
  }
}
