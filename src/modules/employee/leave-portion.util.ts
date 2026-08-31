/**
 * Portion-aware leave overlap helpers.
 *
 * A single calendar day can hold at most one full day of leave, made up of one
 * or two non-overlapping halves ("morning" 00:00-12:00, "afternoon" 12:00-24:00).
 * The legacy check treated every request as a solid [start,end] time range and
 * always expanded half-day / existing leaves to a whole day, so it blocked:
 *   - a morning leave + an afternoon leave on the same day
 *   - a full-day range that merely crossed a day already holding a half-day leave
 *
 * These helpers expand a request into the set of day-halves it occupies, keyed
 * by day, so overlap can be judged per day and per half.
 *
 * Date handling: full-day / half-day requests are persisted at UTC midnight
 * (`new Date('2026-09-15')`), hourly requests at a wall-clock time. We key days
 * with UTC getters, which is stable for the date-only requests overlap actually
 * cares about; hourly clock reads use UTC too for consistency.
 */

export type DayHalf = 'morning' | 'afternoon';
export type DayPortion = 'full' | DayHalf;

export interface LeavePortionInput {
  startDate: Date | string;
  endDate: Date | string;
  startFormat?: string | null;
  endFormat?: string | null;
  leaveMode?: string | null;
  /**
   * Precise per-day portions, when known (i.e. this leave was itself planned
   * by `planDayPortions` and persisted via `LeaveRequestDay`). When present,
   * this replaces the startFormat/endFormat guesswork below — it is the only
   * way a *middle* day of a multi-day request can be a half-day (e.g. a
   * 26–28 full-day request where the 27th was already half-booked, so only
   * its free afternoon got claimed).
   */
  days?: { date: Date | string; portion: DayPortion }[];
}

export interface LeaveConflict {
  /** YYYY-MM-DD */
  date: string;
  existingHalves: DayHalf[];
  requestedHalves: DayHalf[];
}

const NOON_MINUTES = 12 * 60;

/** Statuses that count as "the day/half is already booked". Mirrors the legacy
 *  rule: PENDING_* and APPROVED reserve the slot, REJECTED / CANCELLED do not. */
export const BLOCKING_EXCLUDED_STATUSES = [
  'REJECTED',
  'Rejected',
  'CANCELLED',
  'Cancelled',
];

export function toDayKey(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function normalizePortion(fmt?: string | null): DayPortion {
  if (fmt === 'morning' || fmt === 'afternoon') return fmt;
  return 'full';
}

export function halvesOfPortion(portion: DayPortion): DayHalf[] {
  if (portion === 'morning') return ['morning'];
  if (portion === 'afternoon') return ['afternoon'];
  return ['morning', 'afternoon'];
}

/**
 * Expand a leave request into the day-halves it occupies, keyed by YYYY-MM-DD.
 *
 * - single calendar day  -> startFormat decides (morning / afternoon / full)
 * - multi day            -> first day = startFormat, last day = endFormat,
 *                           days in between are always full.
 *                           Only an "afternoon" start frees the first morning,
 *                           only a "morning" end frees the last afternoon; any
 *                           other boundary format covers the whole boundary day.
 * - hourly               -> the half-day(s) the clock range overlaps (noon split)
 */
export function expandLeaveHalves(
  leave: LeavePortionInput,
): Map<string, Set<DayHalf>> {
  const map = new Map<string, Set<DayHalf>>();

  if (leave.days && leave.days.length > 0) {
    for (const { date, portion } of leave.days) {
      const key = toDayKey(date);
      if (!key) continue;
      map.set(key, new Set(halvesOfPortion(portion)));
    }
    return map;
  }

  const start =
    leave.startDate instanceof Date
      ? leave.startDate
      : new Date(leave.startDate);
  const end =
    leave.endDate instanceof Date ? leave.endDate : new Date(leave.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return map;

  const startKey = toDayKey(start);
  const endKey = toDayKey(end);

  const isHourly =
    leave.leaveMode === 'hourly' ||
    leave.startFormat === 'hourly' ||
    leave.endFormat === 'hourly';

  if (isHourly) {
    const halves = new Set<DayHalf>();
    const startMin = start.getUTCHours() * 60 + start.getUTCMinutes();
    const endMin = end.getUTCHours() * 60 + end.getUTCMinutes();
    if (startMin < NOON_MINUTES) halves.add('morning');
    if (endMin > NOON_MINUTES || endMin <= startMin) halves.add('afternoon');
    if (halves.size === 0) halves.add('afternoon');
    map.set(startKey, halves);
    return map;
  }

  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );

  // guard against absurd ranges
  let guard = 0;
  while (cursor <= last && guard < 750) {
    guard += 1;
    const key = toDayKey(cursor);
    let portion: DayPortion = 'full';
    if (key === startKey && key === endKey) {
      portion = normalizePortion(leave.startFormat);
    } else if (key === startKey) {
      portion = leave.startFormat === 'afternoon' ? 'afternoon' : 'full';
    } else if (key === endKey) {
      portion = leave.endFormat === 'morning' ? 'morning' : 'full';
    }
    map.set(key, new Set(halvesOfPortion(portion)));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return map;
}

/** Union the day-halves of several existing leaves into one map. */
export function buildOccupiedHalves(
  leaves: LeavePortionInput[],
): Map<string, Set<DayHalf>> {
  const occupied = new Map<string, Set<DayHalf>>();
  for (const leave of leaves) {
    for (const [day, halves] of expandLeaveHalves(leave)) {
      const acc = occupied.get(day) ?? new Set<DayHalf>();
      halves.forEach((h) => acc.add(h));
      occupied.set(day, acc);
    }
  }
  return occupied;
}

/**
 * Compare a requested leave against existing leaves, per day and per half.
 * Returns one entry per day that genuinely clashes (same half already taken,
 * or a full day requested over a day that already holds any leave).
 */
export function findPortionConflicts(
  requested: LeavePortionInput,
  existingLeaves: LeavePortionInput[],
): LeaveConflict[] {
  const requestedMap = expandLeaveHalves(requested);
  const occupied = buildOccupiedHalves(existingLeaves);
  const conflicts: LeaveConflict[] = [];

  for (const [day, requestedHalves] of requestedMap) {
    const existingHalves = occupied.get(day);
    if (!existingHalves || existingHalves.size === 0) continue;
    const clashing = [...requestedHalves].filter((h) => existingHalves.has(h));
    if (clashing.length > 0) {
      conflicts.push({
        date: day,
        existingHalves: [...existingHalves].sort(),
        requestedHalves: [...requestedHalves].sort(),
      });
    }
  }
  return conflicts.sort((a, b) => a.date.localeCompare(b.date));
}

export interface DayPortionPlanEntry {
  /** YYYY-MM-DD */
  date: string;
  portion: DayPortion;
}

export type DayPortionPlanResult =
  | { ok: true; days: DayPortionPlanEntry[]; totalDays: number }
  | { ok: false; conflicts: LeaveConflict[] };

/**
 * Plan the per-day portions a new request actually gets to claim, instead of
 * rejecting the whole request the moment any single day of it collides with
 * an existing half-day leave.
 *
 * For each day the request touches, only the halves not already occupied by
 * `existingLeaves` are claimed (an ordinary full-day request degrades to a
 * half-day claim on a day that is already half-booked). A day is only a real
 * conflict — and blocks the whole request — when NONE of the halves the
 * request wants on that day are free. Weekends/holidays are dropped from the
 * output entirely (never claimed, never a conflict), matching the legacy
 * working-day calculation, unless `includeWeekendsAndHolidays` is set (used
 * for calendar-day leave types such as maternity leave).
 */
export function planDayPortions(
  requested: LeavePortionInput,
  existingLeaves: LeavePortionInput[],
  holidays: (Date | string)[] = [],
  includeWeekendsAndHolidays = false,
): DayPortionPlanResult {
  const desiredMap = expandLeaveHalves(requested);
  const occupied = buildOccupiedHalves(existingLeaves);
  const holidayKeys = new Set(holidays.map((h) => toDayKey(h)));

  const days: DayPortionPlanEntry[] = [];
  const conflicts: LeaveConflict[] = [];
  let totalDays = 0;

  for (const [day, desiredHalves] of [...desiredMap.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (!includeWeekendsAndHolidays) {
      const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
      const isWeekend = weekday === 0 || weekday === 6;
      if (isWeekend || holidayKeys.has(day)) continue;
    }

    const existingHalves = occupied.get(day) ?? new Set<DayHalf>();
    const freeHalves = [...desiredHalves].filter((h) => !existingHalves.has(h));

    if (freeHalves.length === 0) {
      conflicts.push({
        date: day,
        existingHalves: [...existingHalves].sort(),
        requestedHalves: [...desiredHalves].sort(),
      });
      continue;
    }

    const portion: DayPortion =
      freeHalves.length === 2 ? 'full' : freeHalves[0];
    days.push({ date: day, portion });
    totalDays += freeHalves.length === 2 ? 1 : 0.5;
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      conflicts: conflicts.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
  return { ok: true, days, totalDays };
}

export function describeHalves(halves: DayHalf[]): string {
  const hasMorning = halves.includes('morning');
  const hasAfternoon = halves.includes('afternoon');
  if (hasMorning && hasAfternoon) return 'เต็มวัน';
  if (hasMorning) return 'ครึ่งวันเช้า';
  if (hasAfternoon) return 'ครึ่งวันบ่าย';
  return '-';
}

export function remainingHalfLabel(existingHalves: DayHalf[]): string | null {
  const hasMorning = existingHalves.includes('morning');
  const hasAfternoon = existingHalves.includes('afternoon');
  if (hasMorning && hasAfternoon) return null;
  if (hasMorning) return 'ครึ่งวันบ่าย';
  if (hasAfternoon) return 'ครึ่งวันเช้า';
  return 'เต็มวัน';
}

function toThaiDate(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  if (!y || !m || !d) return dayKey;
  return `${Number(d)}/${Number(m)}/${Number(y) + 543}`;
}

export function formatConflictMessage(conflicts: LeaveConflict[]): string {
  if (conflicts.length === 0) return '';
  const lines = conflicts.map((conflict) => {
    const taken = describeHalves(conflict.existingHalves);
    const remaining = remainingHalfLabel(conflict.existingHalves);
    const suffix = remaining
      ? ` — วันนี้ยังลาได้เฉพาะ${remaining}`
      : ' — วันนี้ลาครบเต็มวันแล้ว';
    return `• ${toThaiDate(conflict.date)}: มีการลาอยู่แล้ว (${taken})${suffix}`;
  });
  return `ไม่สามารถยื่นคำขอลาได้ เนื่องจากวันต่อไปนี้ทับซ้อนกับการลาเดิมของคุณ:\n${lines.join(
    '\n',
  )}\nกรุณาปรับช่วงวันที่ หรือเลือกรูปแบบการลาให้ตรงกับช่วงเวลาที่ยังว่างอยู่`;
}
