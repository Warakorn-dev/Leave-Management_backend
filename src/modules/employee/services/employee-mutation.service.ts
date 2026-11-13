import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { initialBalanceTotal } from '../leave-balance.util';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateLeaveRequestDto,
  PreviewLeaveRequestDto,
  UpdateLeaveRequestDto,
} from '../dto/employee.dto';
import { NotificationService } from '../../notification/notification.service';
import {
  planDayPortions,
  formatConflictMessage,
  BLOCKING_EXCLUDED_STATUSES,
  LeavePortionInput,
  DayPortionPlanEntry,
} from '../leave-portion.util';

/**
 * Balances are per year and are deducted from the year of the leave's
 * startDate (approval, cancellation), so every check at submission uses that
 * same year rather than today's.
 */
const leaveYearRange = (year: number) => ({
  gte: new Date(`${year}-01-01T00:00:00.000Z`),
  lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
});

/** Leave-request write path: create, edit, and cancel, plus the accrual/overlap rules behind them. */
@Injectable()
export class EmployeeMutationService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  /**
   * Portion-aware planner. Compares the requested leave against the
   * employee's other active leaves per calendar day and per half-day slot, so
   * a morning + an afternoon leave can co-exist on the same day. A day only
   * blocks the whole request when NONE of its requested halves are free —
   * a day that is only partially free (e.g. a full-day request landing on a
   * day whose morning is already taken) degrades to a half-day claim on that
   * one day instead of rejecting the entire range. Throws only for the
   * genuinely-blocked case; otherwise returns the per-day plan to persist.
   */
  private planPortionsOrThrow(
    requested: LeavePortionInput,
    existingLeaves: LeavePortionInput[],
    holidays: (Date | string)[],
    includeWeekendsAndHolidays: boolean,
  ): { days: DayPortionPlanEntry[]; totalDays: number } {
    const plan = planDayPortions(
      requested,
      existingLeaves,
      holidays,
      includeWeekendsAndHolidays,
    );
    if (!plan.ok) {
      throw new BadRequestException(formatConflictMessage(plan.conflicts));
    }
    return plan;
  }

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

  /**
   * Applies the per-leave-type paid/unpaid accrual policy (sick leave 30-day
   * cap, maternity/paternity tiers, military-service 60-day cap, 1-year
   * tenure gate for annual leave, etc). Shared by create and update so the
   * two paths can never drift out of sync with each other.
   * `throwOnUnspecifiedMaternityGender` preserves the pre-refactor behavior
   * difference: creation rejects a maternity-type request when the
   * employee's gender isn't set, update silently leaves it fully paid.
   */
  private async computeAccrual(params: {
    employee: { id: string; gender?: string | null; hireDate: Date };
    leaveTypeId: string;
    leaveTypeName: string;
    calculatedDays: number;
    leaveYear: number;
    excludeRequestId?: string;
    throwOnUnspecifiedMaternityGender: boolean;
  }): Promise<{ paidDays: number; unpaidDays: number }> {
    const {
      employee,
      leaveTypeId,
      leaveTypeName,
      calculatedDays,
      leaveYear,
      excludeRequestId,
      throwOnUnspecifiedMaternityGender,
    } = params;

    let paidDays = calculatedDays;
    let unpaidDays = 0;

    const paidUsedThisYear = async () => {
      const prev = await this.prisma.leaveRequest.aggregate({
        where: {
          employeeId: employee.id,
          leaveTypeId,
          status: { notIn: ['REJECTED', 'Rejected', 'CANCELLED', 'Cancelled'] },
          startDate: leaveYearRange(leaveYear),
          ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
        },
        _sum: { paidDays: true },
      });
      return prev._sum.paidDays || 0;
    };

    // 1. ลาป่วย
    if (leaveTypeName === 'ลาป่วย') {
      const usedPaid = await paidUsedThisYear();
      paidDays = Math.min(calculatedDays, Math.max(0, 30 - usedPaid));
      unpaidDays = calculatedDays - paidDays;
    }
    // 2. ลาเพื่อคลอดบุตร
    else if (leaveTypeName.includes('คลอดบุตร')) {
      if (employee.gender === 'Female') {
        if (calculatedDays > 135)
          throw new BadRequestException(
            'สิทธิ์ลาเพื่อคลอดบุตร สำหรับพนักงานหญิง ไม่เกิน 120 วัน (และลาเพิ่มได้อีก 15 วันหากมีใบรับรองแพทย์)',
          );

        let extraPaid = 0;
        if (calculatedDays > 120) {
          extraPaid = (calculatedDays - 120) * 0.5;
        }
        paidDays = Math.min(calculatedDays, 60) + extraPaid;
        unpaidDays = calculatedDays - paidDays;
      } else if (employee.gender === 'Male') {
        if (calculatedDays > 15)
          throw new BadRequestException(
            'สิทธิ์ลาเพื่อช่วยเหลือภริยาคลอดบุตร สำหรับพนักงานชาย ไม่เกิน 15 วัน',
          );
        paidDays = calculatedDays;
        unpaidDays = 0;
      } else if (throwOnUnspecifiedMaternityGender) {
        throw new BadRequestException(
          'ไม่ระบุเพศพนักงาน ไม่สามารถใช้สิทธิ์ลาคลอดได้ โปรดติดต่อ HR',
        );
      }
    }
    // 3. ลาเพื่อรับราชการทหาร
    else if (leaveTypeName.includes('ทหาร')) {
      const usedPaid = await paidUsedThisYear();
      paidDays = Math.min(calculatedDays, Math.max(0, 60 - usedPaid));
      unpaidDays = calculatedDays - paidDays;
    }
    // 4. ลาพักผ่อนประจำปี (พักร้อน)
    else if (leaveTypeName === 'ลาพักผ่อนประจำปี (พักร้อน)') {
      const msInYear = 1000 * 60 * 60 * 24 * 365;
      const workDurationMs =
        new Date().getTime() - new Date(employee.hireDate).getTime();
      if (workDurationMs < msInYear) {
        throw new BadRequestException(
          'คุณต้องมีอายุงานครบ 1 ปี จึงจะสามารถใช้สิทธิ์ลาพักผ่อนประจำปีได้',
        );
      }
      paidDays = calculatedDays;
    }
    // 5. ลาเพื่อทำหมัน
    else if (leaveTypeName.includes('ทำหมัน')) {
      paidDays = calculatedDays;
      unpaidDays = 0;
    }
    // Other leaves (ลากิจ และอื่นๆ)
    else {
      paidDays = calculatedDays;
    }

    return { paidDays, unpaidDays };
  }

  /**
   * Validates a new leave request against every rule and sizes it (working
   * days, paid/unpaid). Shared by createLeaveRequest and previewLeaveRequest,
   * so what the form shows is exactly what submitting would decide. Writes
   * nothing; throws BadRequest/Forbidden when the request is not allowed.
   * Normalises the format fields of `dto` in place.
   */
  private async evaluateRequest(userId: string, dto: CreateLeaveRequestDto) {
    const employee = await this.getEmployeeByUserId(userId);

    // Business rule: the CEO does not file leave; they only give final approval
    // to managers' requests. The CEO keeps the /leave class role for /me, /types, etc.
    if (employee.user?.role?.name === 'CEO') {
      throw new ForbiddenException('ผู้บริหาร (CEO) ไม่ต้องยื่นคำขอลาในระบบ');
    }

    let startDate: Date;
    let endDate: Date;

    // Map new payload format (leaveMode) if provided
    // Map new payload format (leaveMode) if provided
    if (dto.leaveMode) {
      if (
        dto.leaveMode === 'hourly' &&
        dto.leaveDate &&
        dto.startTime &&
        dto.endTime
      ) {
        startDate = new Date(dto.leaveDate + 'T' + dto.startTime + ':00');
        endDate = new Date(dto.leaveDate + 'T' + dto.endTime + ':00');

        if (endDate <= startDate) {
          throw new BadRequestException('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น');
        }

        const diffMs = endDate.getTime() - startDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        dto.startFormat = 'hourly';
        dto.endFormat = 'hourly';
        dto.leaveHours = diffHours;
      } else if (
        (dto.leaveMode === 'full_day' || dto.leaveMode === 'half_day') &&
        dto.startDate &&
        dto.endDate
      ) {
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
        throw new BadRequestException(
          'ข้อมูลไม่ครบถ้วนสำหรับรูปแบบการลาที่เลือก',
        );
      }
    } else {
      // Fallback for old payload format
      startDate = new Date(dto.startDate!);
      endDate = new Date(dto.endDate!);
    }

    if (startDate > endDate) {
      throw new BadRequestException(
        'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด',
      );
    }

    const holidays = await this.prisma.publicHoliday.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Check Leave Balance
    const leaveYear = startDate.getFullYear();
    const balance = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: dto.leaveTypeId,
          year: leaveYear,
        },
      },
      include: {
        leaveType: true,
      },
    });

    if (!balance) {
      throw new BadRequestException(
        'ไม่พบสิทธิ์วันลาของประเภทนี้ กรุณาติดต่อฝ่ายบุคคล',
      );
    }

    const advanceNoticeDays = balance.leaveType.advanceNoticeDays || 0;
    if (advanceNoticeDays > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const startDay = new Date(startDate);
      startDay.setHours(0, 0, 0, 0);

      const diffTime = startDay.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < advanceNoticeDays) {
        throw new BadRequestException(
          `ต้องยื่นล่วงหน้าอย่างน้อย ${advanceNoticeDays} วัน`,
        );
      }
    }

    const minTenureDays = balance.leaveType.minTenureDays || 0;
    if (minTenureDays > 0) {
      const joinDate = new Date(employee.hireDate);
      const diffTime = startDate.getTime() - joinDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < minTenureDays) {
        throw new BadRequestException(
          `ต้องมีอายุงานอย่างน้อย ${minTenureDays} วัน`,
        );
      }
    }

    const effectiveRemainingDays = await this.effectiveRemainingDays({
      employeeId: employee.id,
      balance,
      endDate,
    });

    const leaveTypeName = balance.leaveType.name;
    const isMaternityFemale =
      leaveTypeName.includes('คลอดบุตร') && employee.gender === 'Female';

    // --- OVERLAP-AWARE DAY PLANNING (per day, per half-day slot) ---
    // A full-day request landing on a day that is already half-booked by
    // another leave degrades to a half-day claim on that one day, instead of
    // rejecting the whole range; only a day with genuinely nothing free
    // blocks the request. See `planDayPortions`.
    const requestedPortion: LeavePortionInput = {
      startDate,
      endDate,
      startFormat: dto.startFormat || 'full',
      endFormat: dto.endFormat || 'full',
      leaveMode: dto.leaveMode,
    };
    const existingRequests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: { notIn: BLOCKING_EXCLUDED_STATUSES },
      },
      include: { days: true },
    });
    const plan = this.planPortionsOrThrow(
      requestedPortion,
      this.toPortionInputs(existingRequests),
      holidays.map((h) => h.date),
      isMaternityFemale,
    );
    // Hourly leaves are sized by the exact clock duration (leaveHours), not
    // by which half of the day they touch.
    const calculatedDays =
      dto.leaveMode === 'hourly'
        ? this.calculateWorkingDays(
            startDate,
            endDate,
            holidays.map((h) => h.date),
            dto.startFormat,
            dto.endFormat,
            isMaternityFemale,
            dto.leaveHours,
          )
        : plan.totalDays;
    // -------------------------

    if (calculatedDays <= 0) {
      throw new BadRequestException(
        'จำนวนวันลาเป็น 0 (อาจตรงกับวันหยุดหรือเสาร์-อาทิตย์) กรุณาเลือกวันใหม่อีกครั้ง',
      );
    }

    if (effectiveRemainingDays < calculatedDays) {
      throw new BadRequestException(
        `สิทธิ์วันลาไม่เพียงพอ (เหลือเพียง ${effectiveRemainingDays} วัน)`,
      );
    }

    const { paidDays, unpaidDays } = await this.computeAccrual({
      employee,
      leaveTypeId: dto.leaveTypeId,
      leaveTypeName,
      calculatedDays,
      leaveYear,
      throwOnUnspecifiedMaternityGender: true,
    });

    return {
      employee,
      startDate,
      endDate,
      balance,
      leaveTypeName,
      isMaternityFemale,
      requestedPortion,
      holidays,
      calculatedDays,
      paidDays,
      unpaidDays,
    };
  }

  /**
   * Dry run of createLeaveRequest for the form: how many days the request
   * would use, or why it would be refused. Creates nothing. Only rule
   * violations are reported as `ok: false`; any other error still propagates.
   */
  async previewLeaveRequest(userId: string, query: PreviewLeaveRequestDto) {
    const dto = Object.assign(new CreateLeaveRequestDto(), query, {
      reason: '',
    });
    try {
      const { calculatedDays } = await this.evaluateRequest(userId, dto);
      return { ok: true, totalDays: calculatedDays, message: null };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ForbiddenException) {
        const body = e.getResponse();
        const message =
          typeof body === 'string'
            ? body
            : [(body as { message?: string | string[] }).message ?? e.message]
                .flat()
                .join('\n');
        return { ok: false, totalDays: null, message };
      }
      throw e;
    }
  }

  async createLeaveRequest(userId: string, dto: CreateLeaveRequestDto) {
    const {
      employee,
      startDate,
      endDate,
      balance,
      leaveTypeName,
      isMaternityFemale,
      requestedPortion,
      holidays,
      calculatedDays,
      paidDays,
      unpaidDays,
    } = await this.evaluateRequest(userId, dto);

    // ทุกคำขอลาเริ่มที่ PENDING_VERIFY เพื่อให้ HR ตรวจสอบก่อนเสมอ
    // Flow: PENDING_VERIFY → (HR) → PENDING_SUPERVISOR → (Manager) → APPROVED (ลาทั่วไป)
    //       PENDING_VERIFY → (HR) → PENDING_SUPERVISOR → (Manager) → PENDING_EXECUTIVE → (CEO) → APPROVED (ลาพิเศษ)
    const initialStatus = 'PENDING_VERIFY';

    // Create Leave Request.
    // Serialize concurrent leave creation for the same employee with a row lock
    // on their existing leaves, then re-run the portion conflict check inside the
    // transaction so two requests submitted at the same time cannot both claim
    // the same half-day slot (race condition guard).
    // The request code (L-{type}-{seq}-{year}) is generated inside the
    // transaction, and the whole transaction is retried when another employee
    // took the same sequence first: the row lock above is per employee, so it
    // cannot serialize the shared counter. The unique index is the final guard.
    const leaveRequest = await this.createWithUniqueRequestCode(
      balance.leaveType.code,
      async (tx, requestCode) => {
        await tx.$queryRaw`SELECT id FROM leaverequest WHERE employeeId = ${employee.id} FOR UPDATE`;
        const freshExisting = await tx.leaveRequest.findMany({
          where: {
            employeeId: employee.id,
            status: { notIn: BLOCKING_EXCLUDED_STATUSES },
          },
          include: { days: true },
        });
        // Re-plan inside the row-locked transaction so two requests submitted
        // at the same time cannot both claim the same half-day slot; also
        // gives us the exact day/portion breakdown to persist.
        const freshPlan = this.planPortionsOrThrow(
          requestedPortion,
          this.toPortionInputs(freshExisting),
          holidays.map((h) => h.date),
          isMaternityFemale,
        );

        return tx.leaveRequest.create({
          data: {
            requestCode,
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
            status: initialStatus,
            days: {
              create: freshPlan.days.map((d) => ({
                date: new Date(`${d.date}T00:00:00.000Z`),
                portion: d.portion,
              })),
            },
          },
        });
      },
    );

    // Notify Approver(s)
    try {
      let durationText = `${calculatedDays} วัน`;
      if (
        dto.leaveMode === 'hourly' ||
        dto.startFormat === 'hourly' ||
        dto.leaveHours ||
        (calculatedDays > 0 && calculatedDays < 0.5)
      ) {
        const hours =
          dto.leaveHours || Math.round(calculatedDays * 8 * 100) / 100;
        durationText = `${hours} ชั่วโมง`;
      } else if (dto.leaveMode === 'half_day' || calculatedDays === 0.5) {
        const periodLabel =
          dto.period === 'morning' || dto.startFormat === 'morning'
            ? 'ช่วงเช้า'
            : dto.period === 'afternoon' || dto.startFormat === 'afternoon'
              ? 'ช่วงบ่าย'
              : 'ครึ่งวัน';
        durationText = `0.5 วัน (${periodLabel})`;
      }

      const startDateStr = startDate.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const endDateStr = endDate.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

      let leaveTimeDetail = '';
      if (dto.leaveMode === 'hourly' || dto.startFormat === 'hourly') {
        const startTimeStr = startDate.toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const endTimeStr = endDate.toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        });
        leaveTimeDetail = `วันที่ ${startDateStr} เวลา ${startTimeStr} - ${endTimeStr} น.`;
      } else if (startDateStr === endDateStr) {
        leaveTimeDetail = `วันที่ ${startDateStr}`;
      } else {
        leaveTimeDetail = `วันที่ ${startDateStr} - ${endDateStr}`;
      }

      if (leaveRequest.status === 'PENDING_VERIFY') {
        const hrs = await this.prisma.employee.findMany({
          where: { user: { role: { name: 'HR' } } },
          include: { user: true },
        });
        for (const hr of hrs) {
          if (hr.user?.id) {
            await this.prisma.notification.create({
              data: {
                userId: hr.user.id,
                title: 'มีคำขอลาใหม่รอตรวจสอบ',
                message: `พนักงาน "${employee.firstName} ${employee.lastName}" ได้ยื่นคำขอ ${leaveTypeName} (${durationText}) ${leaveTimeDetail}`,
                type: 'NEW_ORDER',
                redirectUrl: '/dashboard/hr/approval',
              },
            });
          }
          if (hr.user?.email) {
            await this.notificationService.sendEmail(
              hr.user.email,
              `[Leave Request] ${employee.firstName} ${employee.lastName} ได้ยื่นคำขอลางาน`,
              `เรียน ${hr.firstName},\n\n${employee.firstName} ${employee.lastName} ได้ยื่นคำขอ${leaveTypeName} (${durationText}) ${leaveTimeDetail}\nเหตุผล: ${dto.reason}\n\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบ`,
            );
          }
        }
      } else if (leaveRequest.status === 'PENDING_SUPERVISOR') {
        const managers = await this.prisma.employee.findMany({
          where: {
            departmentId: employee.departmentId,
            user: { role: { name: 'Manager' } },
          },
          include: { user: true },
        });
        for (const manager of managers) {
          if (manager.user?.id) {
            await this.prisma.notification.create({
              data: {
                userId: manager.user.id,
                title: 'มีคำขอลาใหม่ในแผนก',
                message: `พนักงาน "${employee.firstName} ${employee.lastName}" ได้ยื่นคำขอ ${leaveTypeName} (${durationText}) ${leaveTimeDetail}`,
                type: 'NEW_ORDER',
                redirectUrl: '/dashboard/manager/approval',
              },
            });
          }
          if (manager.user?.email) {
            await this.notificationService.sendEmail(
              manager.user.email,
              `[Leave Request] ${employee.firstName} ${employee.lastName} ได้ยื่นคำขอลางาน`,
              `เรียน ${manager.firstName},\n\n${employee.firstName} ${employee.lastName} ได้ยื่นคำขอ${leaveTypeName} (${durationText}) ${leaveTimeDetail}\nเหตุผล: ${dto.reason}\n\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบและพิจารณา`,
            );
          }
        }
      } else if (leaveRequest.status === 'PENDING_EXECUTIVE') {
        const ceos = await this.prisma.user.findMany({
          where: { role: { name: 'CEO' } },
        });
        for (const ceo of ceos) {
          if (ceo.id) {
            await this.prisma.notification.create({
              data: {
                userId: ceo.id,
                title: 'มีคำขอลาจากหัวหน้าแผนก',
                message: `หัวหน้าแผนก "${employee.firstName} ${employee.lastName}" ได้ยื่นคำขอ ${leaveTypeName} (${durationText}) ${leaveTimeDetail}`,
                type: 'NEW_ORDER',
                redirectUrl: '/dashboard/ceo/approval',
              },
            });
          }
          if (ceo.email) {
            await this.notificationService.sendEmail(
              ceo.email,
              `[Leave Request] ${employee.firstName} ${employee.lastName} ได้ยื่นคำขอลางาน`,
              `เรียน CEO,\n\n${employee.firstName} ${employee.lastName} ได้ยื่นคำขอ${leaveTypeName} (${durationText}) ${leaveTimeDetail}\nเหตุผล: ${dto.reason}\n\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบและอนุมัติ`,
            );
          }
        }
      }
    } catch (e) {
      console.error('Failed to send notification', e);
    }

    return leaveRequest;
  }

  async updateLeaveRequest(
    userId: string,
    requestId: string,
    dto: UpdateLeaveRequestDto,
  ) {
    const employee = await this.getEmployeeByUserId(userId);
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: { include: { user: true } }, leaveType: true },
    });

    if (!request) {
      throw new NotFoundException('ไม่พบคำขอลา');
    }

    // Business rule (2026-09-24): only the owner, HR or the CEO may edit a leave
    // still waiting for HR. A department head may NOT edit a subordinate's leave.
    if (
      request.employeeId !== employee.id &&
      employee.user?.role?.name !== 'HR' &&
      employee.user?.role?.name !== 'CEO'
    ) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์แก้ไขคำขอลานี้');
    }

    const allowedStatuses = ['PENDING_VERIFY', 'REVIEWING_HR'];
    if (!allowedStatuses.includes(request.status)) {
      throw new ForbiddenException(
        'สามารถแก้ไขข้อมูลได้เฉพาะคำขอที่ยังไม่ผ่านการตรวจสอบจาก HR เท่านั้น',
      );
    }

    // Balance, overlap, tenure and accrual belong to the leave's owner, not to
    // whoever is editing it (HR/CEO may edit someone else's request).
    const owner = request.employee;

    const dataToUpdate: Record<string, unknown> = { ...dto };
    if (request.status === 'REVIEWING_HR') {
      dataToUpdate.status = 'PENDING_VERIFY';
      dataToUpdate.isViewedByHr = false;
      dataToUpdate.currentHrReviewerId = null;
      dataToUpdate.hrReviewStartedAt = null;
    }

    let newStartDate: Date;
    let newEndDate: Date;

    if (dto.leaveMode) {
      if (
        dto.leaveMode === 'hourly' &&
        dto.leaveDate &&
        dto.startTime &&
        dto.endTime
      ) {
        newStartDate = new Date(dto.leaveDate + 'T' + dto.startTime + ':00');
        newEndDate = new Date(dto.leaveDate + 'T' + dto.endTime + ':00');

        if (newEndDate <= newStartDate) {
          throw new BadRequestException('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น');
        }

        const diffMs = newEndDate.getTime() - newStartDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        dto.startFormat = 'hourly';
        dto.endFormat = 'hourly';
        dto.leaveHours = diffHours;
      } else if (
        (dto.leaveMode === 'full_day' || dto.leaveMode === 'half_day') &&
        dto.startDate &&
        dto.endDate
      ) {
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
        throw new BadRequestException(
          'ข้อมูลไม่ครบถ้วนสำหรับรูปแบบการลาที่เลือก',
        );
      }
    } else {
      newStartDate = dto.startDate
        ? new Date(dto.startDate)
        : request.startDate;
      newEndDate = dto.endDate ? new Date(dto.endDate) : request.endDate;
    }

    if (dto.startDate || dto.endDate || dto.leaveMode) {
      if (newStartDate > newEndDate) {
        throw new BadRequestException(
          'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด',
        );
      }

      const holidays = await this.prisma.publicHoliday.findMany({
        where: {
          date: {
            gte: newStartDate,
            lte: newEndDate,
          },
        },
      });

      const leaveYear = newStartDate.getFullYear();
      const balance = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: owner.id,
            leaveTypeId: request.leaveTypeId,
            year: leaveYear,
          },
        },
        include: {
          leaveType: true,
        },
      });

      if (!balance) {
        throw new BadRequestException(
          'ไม่พบสิทธิ์วันลาของประเภทนี้ กรุณาติดต่อฝ่ายบุคคล',
        );
      }

      const advanceNoticeDays = balance.leaveType?.advanceNoticeDays || 0;
      if (advanceNoticeDays > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const startDay = new Date(newStartDate);
        startDay.setHours(0, 0, 0, 0);

        const diffTime = startDay.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < advanceNoticeDays) {
          throw new BadRequestException(
            `ต้องยื่นล่วงหน้าอย่างน้อย ${advanceNoticeDays} วัน`,
          );
        }
      }

      const minTenureDays = balance.leaveType?.minTenureDays || 0;
      if (minTenureDays > 0) {
        const joinDate = new Date(owner.hireDate);
        const diffTime = newStartDate.getTime() - joinDate.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < minTenureDays) {
          throw new BadRequestException(
            `ต้องมีอายุงานอย่างน้อย ${minTenureDays} วัน`,
          );
        }
      }

      const leaveTypeName = balance.leaveType.name;
      const isMaternityFemale =
        leaveTypeName.includes('คลอดบุตร') && owner.gender === 'Female';
      const isHourly =
        dto.leaveMode === 'hourly' ||
        (!dto.leaveMode && request.startFormat === 'hourly');

      // --- OVERLAP-AWARE DAY PLANNING (per day, per half-day slot) ---
      // The row being edited is excluded so it never clashes with itself; a
      // full-day request landing on a day already half-booked elsewhere
      // degrades to a half-day claim on that one day instead of rejecting
      // the whole range. See `planDayPortions`.
      const editedPortion: LeavePortionInput = {
        startDate: newStartDate,
        endDate: newEndDate,
        startFormat: dto.startFormat || request.startFormat || 'full',
        endFormat: dto.endFormat || request.endFormat || 'full',
        leaveMode: dto.leaveMode,
      };
      const existingRequests = await this.prisma.leaveRequest.findMany({
        where: {
          employeeId: owner.id,
          id: { not: requestId },
          status: { notIn: BLOCKING_EXCLUDED_STATUSES },
        },
        include: { days: true },
      });
      const plan = this.planPortionsOrThrow(
        editedPortion,
        this.toPortionInputs(existingRequests),
        holidays.map((h) => h.date),
        isMaternityFemale,
      );
      const calculatedDays = isHourly
        ? this.calculateWorkingDays(
            newStartDate,
            newEndDate,
            holidays.map((h) => h.date),
            dto.startFormat || request.startFormat,
            dto.endFormat || request.endFormat,
            isMaternityFemale,
            dto.leaveHours,
          )
        : plan.totalDays;
      // -------------------------

      if (calculatedDays <= 0) {
        throw new BadRequestException(
          'จำนวนวันลาเป็น 0 (อาจตรงกับวันหยุดหรือเสาร์-อาทิตย์) กรุณาเลือกวันใหม่อีกครั้ง',
        );
      }

      const effectiveRemainingDays = await this.effectiveRemainingDays({
        employeeId: owner.id,
        balance,
        endDate: newEndDate,
        excludeRequestId: requestId,
      });

      if (effectiveRemainingDays < calculatedDays) {
        throw new BadRequestException(
          `สิทธิ์วันลาไม่เพียงพอ (เหลือเพียง ${effectiveRemainingDays} วัน)`,
        );
      }

      const { paidDays, unpaidDays } = await this.computeAccrual({
        employee: owner,
        leaveTypeId: request.leaveTypeId,
        leaveTypeName,
        calculatedDays,
        leaveYear,
        excludeRequestId: requestId,
        throwOnUnspecifiedMaternityGender: false,
      });

      dataToUpdate.totalDays = calculatedDays;
      dataToUpdate.paidDays = paidDays;
      dataToUpdate.unpaidDays = unpaidDays;
      dataToUpdate.startDate = newStartDate;
      dataToUpdate.endDate = newEndDate;
      dataToUpdate.startFormat = dto.startFormat || request.startFormat;
      dataToUpdate.endFormat = dto.endFormat || request.endFormat;
      // Replace the per-day breakdown with the freshly planned one.
      dataToUpdate.days = {
        deleteMany: {},
        create: plan.days.map((d) => ({
          date: new Date(`${d.date}T00:00:00.000Z`),
          portion: d.portion,
        })),
      };
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
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: { include: { user: true } }, leaveType: true },
    });

    if (!request || request.employeeId !== employee.id) {
      throw new NotFoundException('ไม่พบคำขอลา');
    }

    if (
      request.status === 'PENDING_CANCELLATION' ||
      request.status === 'CANCELLED' ||
      request.status === 'REJECTED'
    ) {
      throw new ForbiddenException(
        request.status === 'PENDING_CANCELLATION'
          ? 'คำขอยกเลิกนี้อยู่ระหว่างรอฝ่ายบุคคลตรวจสอบแล้ว'
          : 'คำขอนี้ไม่สามารถยกเลิกได้แล้ว',
      );
    }

    const unapprovedStatuses = ['PENDING_VERIFY', 'REVIEWING_HR'];
    const isUnapproved = unapprovedStatuses.includes(request.status);

    if (isUnapproved) {
      // ยกเลิกคำขอที่ยังไม่มีใครอนุมัติได้ทันที
      return this.prisma.leaveRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED' },
      });
    }

    // An approved future leave requires HR confirmation before it is cancelled
    // and its balance is returned.
    const updatedRequest = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: 'PENDING_CANCELLATION' },
    });

    const hrs = await this.prisma.employee.findMany({
      where: { user: { role: { name: 'HR' } } },
      include: { user: true },
    });

    for (const hr of hrs) {
      await this.prisma.notification.create({
        data: {
          userId: hr.userId,
          title: 'มีคำขอยกเลิกใบลารอตรวจสอบ',
          message: `${request.employee.firstName} ${request.employee.lastName} ขอยกเลิก${request.leaveType.name}`,
          type: 'NEW_ORDER',
          redirectUrl: '/dashboard/hr/approval',
        },
      });

      if (hr.user.email) {
        await this.notificationService.sendEmail(
          hr.user.email,
          '[Leave Cancellation] รอตรวจสอบ',
          `${request.employee.firstName} ${request.employee.lastName} ขอยกเลิก${request.leaveType.name}`,
        );
      }
    }

    return updatedRequest;
  }

  /**
   * Days a leave starting in `balance.year` can still draw on, after the
   * requests already waiting for approval. A leave that runs into the next
   * year may also use that year's balance (see deductLeaveBalance); if HR has
   * not created it yet, it will be created at approval with its standard
   * starting total, so that total counts here.
   */
  private async effectiveRemainingDays(params: {
    employeeId: string;
    balance: {
      year: number;
      remainingDays: number;
      leaveTypeId: string;
      leaveType: { name: string; defaultDays: number };
    };
    endDate: Date;
    excludeRequestId?: string;
  }): Promise<number> {
    const { employeeId, balance, endDate, excludeRequestId } = params;
    const startYear = balance.year;
    const endYear = endDate.getFullYear();
    if (endYear > startYear + 1) {
      throw new BadRequestException(
        'ไม่สามารถยื่นลาคร่อมเกิน 2 ปีปฏิทินติดกันได้ กรุณาแบ่งเป็นหลายใบลา',
      );
    }

    const pendingIn = async (year: number) => {
      const pending = await this.prisma.leaveRequest.aggregate({
        where: {
          employeeId,
          leaveTypeId: balance.leaveTypeId,
          status: {
            in: [
              'PENDING_VERIFY',
              'REVIEWING_HR',
              'PENDING_SUPERVISOR',
              'PENDING_EXECUTIVE',
            ],
          },
          startDate: leaveYearRange(year),
          ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
        },
        _sum: { totalDays: true },
      });
      return pending._sum.totalDays || 0;
    };

    const startAvailable = balance.remainingDays - (await pendingIn(startYear));
    if (endYear === startYear) return startAvailable;

    const next = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId,
          leaveTypeId: balance.leaveTypeId,
          year: endYear,
        },
      },
    });
    // The start year is used up first, so a new next-year balance carries
    // nothing over (same order as at approval).
    const nextAvailable = next
      ? next.remainingDays - (await pendingIn(endYear))
      : initialBalanceTotal(balance.leaveType, 0);
    return Math.max(0, startAvailable) + Math.max(0, nextAvailable);
  }

  /** Next `L-{typeCode}-{seq 5 digits}-{buddhist year}`, read through `db` (a transaction client). */
  private async nextRequestCode(
    db: Prisma.TransactionClient,
    leaveTypeCode: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const buddhistYear = year + 543;
    const existing = await db.leaveRequest.findMany({
      where: {
        requestCode: { endsWith: `-${buddhistYear}` },
        createdAt: {
          gte: new Date(`${year}-01-01T00:00:00.000Z`),
          lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
        },
      },
      select: { requestCode: true },
    });
    const maxSeq = existing.reduce((max, req) => {
      const seq = Number.parseInt(req.requestCode?.split('-')[2] ?? '', 10);
      return Number.isNaN(seq) ? max : Math.max(max, seq);
    }, 0);
    return `L-${leaveTypeCode}-${String(maxSeq + 1).padStart(5, '0')}-${buddhistYear}`;
  }

  private isRequestCodeCollision(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      JSON.stringify(e.meta?.target ?? '').includes('requestCode')
    );
  }

  /**
   * Runs `create` in a transaction with a freshly computed request code and
   * retries with a new code when the unique index reports a collision.
   */
  private async createWithUniqueRequestCode<T>(
    leaveTypeCode: string,
    create: (tx: Prisma.TransactionClient, requestCode: string) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) =>
          create(tx, await this.nextRequestCode(tx, leaveTypeCode)),
        );
      } catch (e) {
        if (!this.isRequestCodeCollision(e)) throw e;
      }
    }
    throw new ConflictException(
      'ระบบกำลังมีผู้ยื่นคำขอลาจำนวนมาก ไม่สามารถออกเลขที่คำขอได้ กรุณาลองใหม่อีกครั้ง',
    );
  }

  private async getEmployeeByUserId(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: { user: { include: { role: true } } },
    });
    if (!employee) throw new NotFoundException('ไม่พบข้อมูลพนักงาน');
    return employee;
  }

  private calculateWorkingDays(
    startDate: Date,
    endDate: Date,
    holidays: Date[],
    startFormat: string = 'full',
    endFormat: string = 'full',
    includeHolidaysAndWeekends: boolean = false,
    leaveHours: number = 0,
  ): number {
    let count = 0;
    const curDate = new Date(startDate);
    curDate.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    const holidayTimes = new Set(
      holidays.map((h) => {
        const d = new Date(h);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      }),
    );

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
        count -= 1 - leaveHours / 8;
      }

      const isSameDay =
        startDate.getFullYear() === endDate.getFullYear() &&
        startDate.getMonth() === endDate.getMonth() &&
        startDate.getDate() === endDate.getDate();

      if (
        !isSameDay &&
        (endFormat === 'morning' || endFormat === 'afternoon')
      ) {
        count -= 0.5;
      } else if (!isSameDay && endFormat === 'hourly' && leaveHours > 0) {
        count -= 1 - leaveHours / 8;
      }
    }

    return count;
  }
}
