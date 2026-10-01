import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import {
  isDepartmentApprover,
  isLeaderPosition,
  leaveHistoryUrlForRole,
} from '../../notification/leave-history-url';

/** HR's first-pass review of leave requests: pending queue, view-lock, approve/reject. */
@Injectable()
export class HrLeaveVerificationService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  /**
   * Department heads who can act on PENDING_SUPERVISOR requests: users with
   * role Manager, or HR users whose position is a leader/manager — the same
   * people ManagerService lets through. The requester is never their own approver.
   */
  private async findDepartmentApprovers(
    departmentId: string | null,
    requesterEmployeeId: string,
  ) {
    // An employee without a department has no department head.
    if (!departmentId) return [];
    const include = {
      user: { include: { role: true } },
      position: true,
    } as const;
    const [managers, hrStaff] = await Promise.all([
      this.prisma.employee.findMany({
        where: { departmentId, user: { role: { name: 'Manager' } } },
        include,
      }),
      this.prisma.employee.findMany({
        where: { departmentId, user: { role: { name: 'HR' } } },
        include,
      }),
    ]);
    return [...managers, ...hrStaff].filter(
      (e) =>
        e.id !== requesterEmployeeId &&
        isDepartmentApprover(e.user?.role?.name, e.position?.name),
    );
  }

  /**
   * No one can approve at department level: tell HR instead of letting the
   * request sit in PENDING_SUPERVISOR unnoticed. The workflow itself is unchanged.
   */
  private async notifyMissingDepartmentApprover(request: {
    employee: { firstName: string; lastName: string };
    leaveType: { name: string };
  }) {
    const hrs = await this.prisma.user.findMany({
      where: { role: { name: 'HR' } },
    });
    for (const hr of hrs) {
      await this.prisma.notification.create({
        data: {
          userId: hr.id,
          title: 'ไม่พบหัวหน้าแผนกที่อนุมัติคำขอลาได้',
          message: `คำขอ${request.leaveType.name} ของ ${request.employee.firstName} ${request.employee.lastName} ผ่านการตรวจสอบแล้ว แต่แผนกนี้ยังไม่มีหัวหน้าแผนกที่อนุมัติได้ กรุณากำหนดหัวหน้าแผนก`,
          type: 'SYSTEM',
          redirectUrl: '/dashboard/hr/leave-history',
        },
      });
    }
  }

  async getPendingVerify(hrUserId: string) {
    const hrEmployee = await this.prisma.employee.findUnique({
      where: { userId: hrUserId },
    });

    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        status: {
          in: ['PENDING_VERIFY', 'REVIEWING_HR', 'PENDING_CANCELLATION'],
        },
        ...(hrEmployee ? { employeeId: { not: hrEmployee.id } } : {}),
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
          select: {
            id: true,
            username: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
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
      include: { employee: true },
    });
    if (!request) {
      throw new BadRequestException('Request not found');
    }

    if (request.employee.userId === hrUserId) {
      throw new BadRequestException('คุณไม่สามารถตรวจสอบคำขอลาของตนเองได้');
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
        employee: {
          include: { position: true, user: { include: { role: true } } },
        },
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

    if (request.employee.userId === hrUserId) {
      throw new BadRequestException('คุณไม่สามารถตรวจสอบคำขอลาของตนเองได้');
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
                redirectUrl: leaveHistoryUrlForRole(employeeUser.role?.name),
              },
            });
            if (employeeUser.email) {
              await this.notificationService.sendEmail(
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
      const roleName = request.employee.user?.role?.name || '';
      const posName = request.employee.position?.name || '';
      // Department heads (role Manager/CEO, or a Leader position) go to the CEO.
      const isLeaderOrManager =
        ['Manager', 'CEO'].includes(roleName) ||
        isLeaderPosition(posName) ||
        roleName.toLowerCase().includes('leader');
      const isManagerOrCEO = isLeaderOrManager;
      nextStatus = isManagerOrCEO ? 'PENDING_EXECUTIVE' : 'PENDING_SUPERVISOR';
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
            await this.notificationService.sendEmail(
              employeeUser.email,
              `[Leave Request] คำขอลางานของคุณถูกปฏิเสธ (ตรวจสอบเบื้องต้น)`,
              `เรียน ${request.employee.firstName},\n\nคำขอ${request.leaveType.name} ของคุณถูกปฏิเสธในขั้นตอนตรวจสอบโดย HR\nเหตุผล: ${dto.comment || '-'}\n\nกรุณาเข้าสู่ระบบเพื่อยื่นคำขอใหม่หรือแก้ไข`,
            );
          } else if (
            action === 'Approve' &&
            nextStatus === 'PENDING_SUPERVISOR'
          ) {
            // Notify whoever can approve for this department: role Manager, or
            // an HR department head (same access rule as ManagerService).
            const managers = await this.findDepartmentApprovers(
              request.employee.departmentId,
              request.employee.id,
            );
            if (managers.length === 0) {
              await this.notifyMissingDepartmentApprover(request);
            }
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
                await this.notificationService.sendEmail(
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
                await this.notificationService.sendEmail(
                  ceo.email,
                  '[Leave Request] รอผู้บริหารอนุมัติ',
                  `คำขอ${request.leaveType.name} ของ ${request.employee.firstName} ${request.employee.lastName} รอการอนุมัติจากคุณ`,
                );
              }
            }
          }

          // The next approver depends on where the request was routed.
          const nextApproverText =
            nextStatus === 'PENDING_EXECUTIVE'
              ? 'ผู้บริหาร (CEO)'
              : 'หัวหน้าแผนก';

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
                    : `คำขอลาของคุณกำลังรอการอนุมัติจาก${nextApproverText}`,
                type: 'SYSTEM',
                redirectUrl: leaveHistoryUrlForRole(
                  request.employee.user?.role?.name,
                ),
              },
            });
          }
          if (employeeUser?.email && action !== 'Reject') {
            await this.notificationService.sendEmail(
              employeeUser.email,
              `[Leave Request] คำขอลาผ่านการตรวจสอบเบื้องต้นจาก HR`,
              `เรียน ${request.employee.firstName},\n\nคำขอ${request.leaveType.name} ของคุณ (วันที่ ${request.startDate.toLocaleDateString()} ถึง ${request.endDate.toLocaleDateString()}) ผ่านการตรวจสอบเบื้องต้นโดยฝ่ายบุคคล (HR) แล้ว\nขณะนี้กำลังรอการอนุมัติจาก${nextApproverText}ต่อไป\n\nคุณสามารถตรวจสอบสถานะได้ในระบบ`,
            );
          }
        } catch (e) {
          console.error('Failed to send notification', e);
        }
        return updatedRequest;
      });
  }
}
