/// <reference types="jest" />
import {
  expandLeaveHalves,
  findPortionConflicts,
  buildOccupiedHalves,
  toDayKey,
  formatConflictMessage,
  planDayPortions,
  LeavePortionInput,
} from './leave-portion.util';

/** Helpers mirroring how the service builds Date values from a payload. */
const fullDay = (
  startDate: string,
  endDate = startDate,
): LeavePortionInput => ({
  startDate: new Date(startDate),
  endDate: new Date(endDate),
  startFormat: 'full',
  endFormat: 'full',
});

const halfDay = (
  date: string,
  period: 'morning' | 'afternoon',
): LeavePortionInput => ({
  startDate: new Date(date),
  endDate: new Date(date),
  startFormat: period,
  endFormat: period,
});

const conflictsFor = (
  requested: LeavePortionInput,
  existing: LeavePortionInput[],
) => findPortionConflicts(requested, existing);

describe('leave-portion.util', () => {
  describe('expandLeaveHalves', () => {
    it('single full day occupies both halves', () => {
      const map = expandLeaveHalves(fullDay('2026-09-15'));
      expect([...map.get('2026-09-15')!].sort()).toEqual([
        'afternoon',
        'morning',
      ]);
    });

    it('single morning half occupies only the morning', () => {
      const map = expandLeaveHalves(halfDay('2026-09-15', 'morning'));
      expect([...map.get('2026-09-15')!]).toEqual(['morning']);
    });

    it('single afternoon half occupies only the afternoon', () => {
      const map = expandLeaveHalves(halfDay('2026-09-15', 'afternoon'));
      expect([...map.get('2026-09-15')!]).toEqual(['afternoon']);
    });

    it('multi-day full leave marks every day in range', () => {
      const map = expandLeaveHalves(fullDay('2026-09-14', '2026-09-16'));
      expect([...map.keys()].sort()).toEqual([
        '2026-09-14',
        '2026-09-15',
        '2026-09-16',
      ]);
      expect([...map.get('2026-09-15')!].sort()).toEqual([
        'afternoon',
        'morning',
      ]);
    });

    it('afternoon start frees the first morning, full days after', () => {
      const map = expandLeaveHalves({
        startDate: new Date('2026-09-14'),
        endDate: new Date('2026-09-16'),
        startFormat: 'afternoon',
        endFormat: 'full',
      });
      expect([...map.get('2026-09-14')!]).toEqual(['afternoon']);
      expect([...map.get('2026-09-16')!].sort()).toEqual([
        'afternoon',
        'morning',
      ]);
    });

    it('hourly leave before noon occupies the morning', () => {
      const map = expandLeaveHalves({
        startDate: new Date('2026-09-15T08:00:00Z'),
        endDate: new Date('2026-09-15T10:00:00Z'),
        startFormat: 'hourly',
        endFormat: 'hourly',
      });
      expect([...map.get('2026-09-15')!]).toEqual(['morning']);
    });
  });

  describe('same-day half-day rules (TEST 1-10)', () => {
    it('TEST 1: no existing leave + full day -> allowed', () => {
      expect(conflictsFor(fullDay('2026-09-15'), [])).toHaveLength(0);
    });

    it('TEST 2: no existing leave + morning -> allowed', () => {
      expect(conflictsFor(halfDay('2026-09-15', 'morning'), [])).toHaveLength(
        0,
      );
    });

    it('TEST 3: no existing leave + afternoon -> allowed', () => {
      expect(conflictsFor(halfDay('2026-09-15', 'afternoon'), [])).toHaveLength(
        0,
      );
    });

    it('TEST 4: morning exists + morning -> blocked', () => {
      const conflicts = conflictsFor(halfDay('2026-09-15', 'morning'), [
        halfDay('2026-09-15', 'morning'),
      ]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].date).toBe('2026-09-15');
    });

    it('TEST 5: morning exists + afternoon -> allowed', () => {
      expect(
        conflictsFor(halfDay('2026-09-15', 'afternoon'), [
          halfDay('2026-09-15', 'morning'),
        ]),
      ).toHaveLength(0);
    });

    it('TEST 6: afternoon exists + morning -> allowed', () => {
      expect(
        conflictsFor(halfDay('2026-09-15', 'morning'), [
          halfDay('2026-09-15', 'afternoon'),
        ]),
      ).toHaveLength(0);
    });

    it('TEST 7: afternoon exists + afternoon -> blocked', () => {
      expect(
        conflictsFor(halfDay('2026-09-15', 'afternoon'), [
          halfDay('2026-09-15', 'afternoon'),
        ]),
      ).toHaveLength(1);
    });

    it('TEST 8: full day exists + morning -> blocked', () => {
      expect(
        conflictsFor(halfDay('2026-09-15', 'morning'), [fullDay('2026-09-15')]),
      ).toHaveLength(1);
    });

    it('TEST 9: full day exists + afternoon -> blocked', () => {
      expect(
        conflictsFor(halfDay('2026-09-15', 'afternoon'), [
          fullDay('2026-09-15'),
        ]),
      ).toHaveLength(1);
    });

    it('TEST 10: full day exists + full day -> blocked', () => {
      expect(
        conflictsFor(fullDay('2026-09-15'), [fullDay('2026-09-15')]),
      ).toHaveLength(1);
    });

    it('morning + afternoon already booked -> full day blocked', () => {
      const existing = [
        halfDay('2026-09-15', 'morning'),
        halfDay('2026-09-15', 'afternoon'),
      ];
      expect(conflictsFor(fullDay('2026-09-15'), existing)).toHaveLength(1);
      expect(
        conflictsFor(halfDay('2026-09-15', 'morning'), existing),
      ).toHaveLength(1);
    });
  });

  describe('date-range crossing an existing half day (TEST 11)', () => {
    it('reports only the conflicting middle day, not the whole range', () => {
      const conflicts = conflictsFor(fullDay('2026-09-14', '2026-09-16'), [
        halfDay('2026-09-15', 'morning'),
      ]);
      expect(conflicts.map((c) => c.date)).toEqual(['2026-09-15']);
      expect(conflicts[0].existingHalves).toEqual(['morning']);
    });

    it('a range that only needs the still-free half is allowed', () => {
      // existing morning on the 15th; new leave 15th afternoon -> 16th full
      const conflicts = conflictsFor(
        {
          startDate: new Date('2026-09-15'),
          endDate: new Date('2026-09-16'),
          startFormat: 'afternoon',
          endFormat: 'full',
        },
        [halfDay('2026-09-15', 'morning')],
      );
      expect(conflicts).toHaveLength(0);
    });

    it('message names each conflicting day and the remaining half', () => {
      const conflicts = conflictsFor(fullDay('2026-09-14', '2026-09-16'), [
        halfDay('2026-09-15', 'afternoon'),
      ]);
      const message = formatConflictMessage(conflicts);
      expect(message).toContain('15/9/2569');
      expect(message).toContain('ครึ่งวันบ่าย');
      expect(message).toContain('ครึ่งวันเช้า'); // still-free half is suggested
    });
  });

  describe('edit / self exclusion (TEST 12-13)', () => {
    it('TEST 12: editing keeps no conflict when its own row is excluded', () => {
      // caller is responsible for filtering out the edited row; simulate that.
      const own = halfDay('2026-09-15', 'morning');
      const others: LeavePortionInput[] = [];
      const conflicts = conflictsFor(halfDay('2026-09-15', 'afternoon'), [
        ...others,
      ]);
      expect(conflicts).toHaveLength(0);
      // sanity: if own row were NOT excluded it also would not clash (m vs a)
      expect(
        conflictsFor(halfDay('2026-09-15', 'afternoon'), [own]),
      ).toHaveLength(0);
    });

    it('TEST 13: editing to a slot taken by someone else is blocked', () => {
      const otherPersonLeave = halfDay('2026-09-15', 'afternoon');
      expect(
        conflictsFor(halfDay('2026-09-15', 'afternoon'), [otherPersonLeave]),
      ).toHaveLength(1);
    });
  });

  describe('status filtering (TEST 14-15)', () => {
    it('TEST 14 & 15: rejected / cancelled leaves are excluded by the caller', () => {
      // The util itself is status-agnostic; the service filters. Verify that a
      // filtered-out leave produces no conflict when not passed in.
      expect(conflictsFor(fullDay('2026-09-15'), [])).toHaveLength(0);
    });
  });

  describe('weekend / holiday (TEST 16-17)', () => {
    it('overlap detection is calendar-based and unaffected by weekends', () => {
      // 2026-09-19 is a Saturday. Overlap logic still keys by day; the working
      // day count (calculateWorkingDays) is what handles weekend exclusion.
      const saturday = '2026-09-19';
      expect(toDayKey(new Date(saturday))).toBe(saturday);
      expect(
        conflictsFor(fullDay(saturday), [halfDay(saturday, 'morning')]),
      ).toHaveLength(1);
    });
  });

  describe('planDayPortions', () => {
    it('a full-day range degrades the already-half-booked middle day to its free half (2.5 days, not blocked)', () => {
      // Reported case: the middle day's morning is already leave; requesting
      // a full-day range spanning it must still go through, claiming only
      // that day's afternoon, for a total of 2.5 days.
      // 2026-09-21/22/23 are Mon/Tue/Wed.
      const existing = [halfDay('2026-09-22', 'morning')];
      const plan = planDayPortions(
        fullDay('2026-09-21', '2026-09-23'),
        existing,
      );
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      expect(plan.totalDays).toBe(2.5);
      expect(plan.days).toEqual([
        { date: '2026-09-21', portion: 'full' },
        { date: '2026-09-22', portion: 'afternoon' },
        { date: '2026-09-23', portion: 'full' },
      ]);
    });

    it('still blocks a day that is fully taken already', () => {
      const existing = [fullDay('2026-09-22')];
      const plan = planDayPortions(
        fullDay('2026-09-21', '2026-09-23'),
        existing,
      );
      expect(plan.ok).toBe(false);
      if (plan.ok) return;
      expect(plan.conflicts).toHaveLength(1);
      expect(plan.conflicts[0].date).toBe('2026-09-22');
    });

    it('blocks when the requested half on that day is exactly the one taken', () => {
      const existing = [halfDay('2026-09-22', 'afternoon')];
      const plan = planDayPortions(
        halfDay('2026-09-22', 'afternoon'),
        existing,
      );
      expect(plan.ok).toBe(false);
    });

    it('drops weekends/holidays from the plan and total', () => {
      // 2026-09-19 is a Saturday, 2026-09-20 a Sunday.
      const plan = planDayPortions(fullDay('2026-09-18', '2026-09-21'), []);
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      expect(plan.days.map((d) => d.date)).toEqual([
        '2026-09-18',
        '2026-09-21',
      ]);
      expect(plan.totalDays).toBe(2);
    });
  });

  describe('balance is not double counted', () => {
    it('morning + afternoon on one day are two separate half slots', () => {
      const occupied = buildOccupiedHalves([
        halfDay('2026-09-15', 'morning'),
        halfDay('2026-09-15', 'afternoon'),
      ]);
      expect([...occupied.get('2026-09-15')!].sort()).toEqual([
        'afternoon',
        'morning',
      ]);
    });
  });
});
