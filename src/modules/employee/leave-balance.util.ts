import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Leave balances are per calendar year. A leave is deducted when it becomes
 * APPROVED, from the balance of the year it STARTS in; if that is not enough
 * and the leave runs into the next year, the rest comes from the next year's
 * balance (created on the spot when HR has not created it yet). Each year's
 * share is recorded in LeaveBalanceDeduction so a cancellation refunds the
 * same years.
 */

export const VACATION_CARRY_OVER_MAX = 12;

export function isVacationLeaveType(name: string): boolean {
  return name.includes('พักผ่อน') || name.includes('พักร้อน');
}

/**
 * Total days of a freshly created yearly balance. Vacation leave carries the
 * previous year's remaining days over (up to VACATION_CARRY_OVER_MAX); every
 * other type starts at its default. `prevRemainingDays` is null/undefined when
 * the employee had no balance the year before.
 */
export function initialBalanceTotal(
  type: { name: string; defaultDays: number },
  prevRemainingDays: number | null | undefined,
): number {
  if (isVacationLeaveType(type.name) && prevRemainingDays != null) {
    return Math.min(
      VACATION_CARRY_OVER_MAX,
      prevRemainingDays + type.defaultDays,
    );
  }
  return type.defaultDays;
}

export const INSUFFICIENT_BALANCE_MESSAGE = 'สิทธิ์วันลาคงเหลือไม่เพียงพอ';

interface DeductibleLeave {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  totalDays: number;
}

/** The balance of `year`, created with the standard starting total when missing. */
async function balanceForYear(
  tx: Prisma.TransactionClient,
  leave: DeductibleLeave,
  year: number,
  prevRemainingDays: number,
) {
  const where = {
    employeeId: leave.employeeId,
    leaveTypeId: leave.leaveTypeId,
    year,
  };
  const existing = await tx.leaveBalance.findFirst({ where });
  if (existing) return existing;

  const type = await tx.leaveType.findUniqueOrThrow({
    where: { id: leave.leaveTypeId },
  });
  const total = initialBalanceTotal(type, prevRemainingDays);
  // skipDuplicates: another approval for the same employee and type may create
  // the same row at the same moment (unique on employee + type + year).
  await tx.leaveBalance.createMany({
    data: [{ ...where, totalDays: total, usedDays: 0, remainingDays: total }],
    skipDuplicates: true,
  });
  return tx.leaveBalance.findFirstOrThrow({ where });
}

/**
 * Takes `leave.totalDays` from the balances, start year first. Does nothing
 * when the employee has no balance for the start year (nothing to deduct
 * from). Throws BadRequestException when the balances cannot cover the leave,
 * which rolls the surrounding transaction back.
 */
export async function deductLeaveBalance(
  tx: Prisma.TransactionClient,
  leave: DeductibleLeave,
): Promise<void> {
  const startYear = leave.startDate.getFullYear();
  const first = await tx.leaveBalance.findFirst({
    where: {
      employeeId: leave.employeeId,
      leaveTypeId: leave.leaveTypeId,
      year: startYear,
    },
  });
  if (!first) return;

  const fromFirst = Math.min(Math.max(first.remainingDays, 0), leave.totalDays);
  const overflow = leave.totalDays - fromFirst;

  const takes: { balance: typeof first; days: number }[] = [];
  if (fromFirst > 0) takes.push({ balance: first, days: fromFirst });

  if (overflow > 0) {
    if (leave.endDate.getFullYear() <= startYear) {
      throw new BadRequestException(INSUFFICIENT_BALANCE_MESSAGE);
    }
    // The start year is used up by now, so nothing is carried over from it.
    const next = await balanceForYear(
      tx,
      leave,
      startYear + 1,
      first.remainingDays - fromFirst,
    );
    if (next.remainingDays < overflow) {
      throw new BadRequestException(INSUFFICIENT_BALANCE_MESSAGE);
    }
    takes.push({ balance: next, days: overflow });
  }

  for (const { balance, days } of takes) {
    const remainingDays = balance.remainingDays - days;
    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: { usedDays: balance.totalDays - remainingDays, remainingDays },
    });
    await tx.leaveBalanceDeduction.create({
      data: { leaveRequestId: leave.id, leaveBalanceId: balance.id, days },
    });
  }
}

/**
 * Gives back what deductLeaveBalance took, year by year. A leave approved
 * before deductions were recorded has no rows; its days go back to the
 * start-year balance, as before.
 */
export async function refundLeaveBalance(
  tx: Prisma.TransactionClient,
  leave: Omit<DeductibleLeave, 'endDate'>,
): Promise<void> {
  const rows = await tx.leaveBalanceDeduction.findMany({
    where: { leaveRequestId: leave.id },
  });
  const refunds = rows.length
    ? rows.map((r) => ({ balanceId: r.leaveBalanceId, days: r.days }))
    : await legacyRefund(tx, leave);

  for (const { balanceId, days } of refunds) {
    const balance = await tx.leaveBalance.findFirst({
      where: { id: balanceId },
    });
    if (!balance) continue;
    const remainingDays = Math.min(
      balance.totalDays,
      balance.remainingDays + days,
    );
    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: {
        usedDays: Math.max(0, balance.totalDays - remainingDays),
        remainingDays,
      },
    });
  }
  if (rows.length) {
    await tx.leaveBalanceDeduction.deleteMany({
      where: { leaveRequestId: leave.id },
    });
  }
}

async function legacyRefund(
  tx: Prisma.TransactionClient,
  leave: Omit<DeductibleLeave, 'endDate'>,
): Promise<{ balanceId: string; days: number }[]> {
  const balance = await tx.leaveBalance.findFirst({
    where: {
      employeeId: leave.employeeId,
      leaveTypeId: leave.leaveTypeId,
      year: leave.startDate.getFullYear(),
    },
  });
  return balance ? [{ balanceId: balance.id, days: leave.totalDays }] : [];
}
