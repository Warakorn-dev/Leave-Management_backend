/// <reference types="jest" />
/* eslint-disable @typescript-eslint/require-await -- mocks mirror Prisma's async API */
/**
 * In-memory stand-in for PrismaService used by the leave business-flow tests.
 *
 * It keeps real state (leave requests, approvals, balances, notifications) so
 * the actual services can be chained end to end — employee submits → HR
 * verifies → manager approves → CEO approves — without touching MySQL. Every
 * model method is a jest.fn, so tests can assert both the resulting state and
 * the exact Prisma calls a service made.
 *
 * Only the query shapes the leave services actually use are supported.
 */

export type Role = 'Employee' | 'Manager' | 'HR' | 'CEO' | 'Admin';

export interface SeedUser {
  id: string;
  email: string | null;
  role: Role;
}
export interface SeedEmployee {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  positionName: string;
  gender?: 'Male' | 'Female' | null;
  hireDate: Date;
}
export interface SeedLeaveType {
  id: string;
  code: string;
  name: string;
  isSpecial: boolean;
  defaultDays: number;
  advanceNoticeDays?: number;
  minTenureDays?: number;
}

export interface LeaveRow {
  id: string;
  requestCode: string | null;
  employeeId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  startFormat: string;
  endFormat: string;
  totalDays: number;
  paidDays: number;
  unpaidDays: number;
  reason: string | null;
  status: string;
  isViewedByHr: boolean;
  currentHrReviewerId: string | null;
  hrReviewStartedAt: Date | null;
  createdAt: Date;
  days: { date: Date; portion: string }[];
}
export interface ApprovalRow {
  leaveRequestId: string;
  approverId: string;
  status: string;
  comment: string | null;
}
export interface BalanceRow {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
}
export interface NotificationRow {
  userId: string;
  title: string;
  message: string;
  type: string;
  redirectUrl?: string;
}

// ---- default organisation ---------------------------------------------------
export const YEAR = 2026;
/** Frozen "today" for the tests (Thailand morning, 1 Sep 2026). */
export const TODAY = new Date('2026-09-01T03:00:00.000Z');

export const LT = {
  sick: {
    id: 'lt-sick',
    code: '01',
    name: 'ลาป่วย',
    isSpecial: false,
    defaultDays: 30,
  },
  business: {
    id: 'lt-business',
    code: '02',
    name: 'ลากิจธุระอันจำเป็น',
    isSpecial: false,
    defaultDays: 3,
  },
  vacation: {
    id: 'lt-vacation',
    code: '07',
    name: 'ลาพักผ่อนประจำปี (พักร้อน)',
    isSpecial: true,
    defaultDays: 6,
  },
  ordination: {
    id: 'lt-ordination',
    code: '08',
    name: 'ลาอุปสมบท',
    isSpecial: true,
    defaultDays: 120,
  },
} satisfies Record<string, SeedLeaveType>;

export const U = {
  emp: 'u-emp',
  emp2: 'u-emp2',
  empOtherDept: 'u-emp-d2',
  leaderEmp: 'u-leader',
  mgr: 'u-mgr',
  mgrOtherDept: 'u-mgr-d2',
  hr: 'u-hr',
  hr2: 'u-hr2',
  hrLeader: 'u-hr-lead',
  ceo: 'u-ceo',
  admin: 'u-admin',
  noEmployee: 'u-ghost',
} as const;

export function defaultOrg(): { users: SeedUser[]; employees: SeedEmployee[] } {
  const hire = new Date('2020-01-15T00:00:00.000Z');
  const users: SeedUser[] = [
    { id: U.emp, email: 'emp@nid.test', role: 'Employee' },
    { id: U.emp2, email: 'emp2@nid.test', role: 'Employee' },
    { id: U.empOtherDept, email: 'emp-d2@nid.test', role: 'Employee' },
    { id: U.leaderEmp, email: 'leader@nid.test', role: 'Employee' },
    { id: U.mgr, email: 'mgr@nid.test', role: 'Manager' },
    { id: U.mgrOtherDept, email: 'mgr-d2@nid.test', role: 'Manager' },
    { id: U.hr, email: 'hr@nid.test', role: 'HR' },
    { id: U.hr2, email: 'hr2@nid.test', role: 'HR' },
    { id: U.hrLeader, email: 'hr-lead@nid.test', role: 'HR' },
    { id: U.ceo, email: 'ceo@nid.test', role: 'CEO' },
    { id: U.admin, email: 'admin@nid.test', role: 'Admin' },
    { id: U.noEmployee, email: 'ghost@nid.test', role: 'Employee' },
  ];
  const e = (
    id: string,
    userId: string,
    firstName: string,
    departmentId: string,
    positionName: string,
    gender: 'Male' | 'Female' = 'Female',
  ): SeedEmployee => ({
    id,
    userId,
    firstName,
    lastName: 'ทดสอบ',
    departmentId,
    positionName,
    gender,
    hireDate: hire,
  });
  const employees: SeedEmployee[] = [
    e('emp-1', U.emp, 'สมหญิง', 'dept-dev', 'Programmer'),
    e('emp-2', U.emp2, 'สมศรี', 'dept-dev', 'Programmer'),
    e('emp-d2', U.empOtherDept, 'สมปอง', 'dept-sales', 'Sales'),
    e('emp-leader', U.leaderEmp, 'สมชาย', 'dept-dev', 'Team Leader', 'Male'),
    e('emp-mgr', U.mgr, 'วิไล', 'dept-dev', 'Manager'),
    e('emp-mgr-d2', U.mgrOtherDept, 'วีระ', 'dept-sales', 'Manager', 'Male'),
    e('emp-hr', U.hr, 'ฮาน่า', 'dept-hr', 'HR Officer'),
    e('emp-hr2', U.hr2, 'ฮารุ', 'dept-hr', 'HR Officer'),
    e('emp-hr-lead', U.hrLeader, 'รอฮายู', 'dept-hr', 'Leader'),
    e('emp-ceo', U.ceo, 'ซีอีโอ', 'dept-exec', 'CEO', 'Male'),
  ];
  return { users, employees };
}

// ---- where-clause matcher -----------------------------------------------------
type Cond = unknown;
function matchValue(actual: unknown, cond: Cond): boolean {
  if (cond === undefined) return true;
  if (cond === null) return actual === null || actual === undefined;
  if (cond instanceof Date)
    return actual instanceof Date && actual.getTime() === cond.getTime();
  if (typeof cond !== 'object') return actual === cond;
  const c = cond as Record<string, unknown>;
  if ('in' in c && !(c.in as unknown[]).includes(actual)) return false;
  if ('notIn' in c && (c.notIn as unknown[]).includes(actual)) return false;
  if ('not' in c && actual === c.not) return false;
  if (
    'endsWith' in c &&
    !(typeof actual === 'string' && actual.endsWith(c.endsWith as string))
  )
    return false;
  if (
    'contains' in c &&
    !(typeof actual === 'string' && actual.includes(c.contains as string))
  )
    return false;
  if ('gte' in c && !((actual as Date) >= (c.gte as Date))) return false;
  if ('lte' in c && !((actual as Date) <= (c.lte as Date))) return false;
  if ('lt' in c && !((actual as Date) < (c.lt as Date))) return false;
  return true;
}
function matchWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown> = {},
): boolean {
  return Object.entries(where).every(([k, cond]) => matchValue(row[k], cond));
}

// ---- fake --------------------------------------------------------------------
export function createFakePrisma(
  opts: {
    users?: SeedUser[];
    employees?: SeedEmployee[];
    leaveTypes?: SeedLeaveType[];
    /** override / remove balances: employeeId -> leaveTypeId -> remaining (null = no balance row) */
    balanceOverrides?: Record<string, Record<string, number | null>>;
  } = {},
) {
  const org = defaultOrg();
  const users = opts.users ?? org.users;
  const employees = opts.employees ?? org.employees;
  const leaveTypes = opts.leaveTypes ?? Object.values(LT);

  const state = {
    leaveRequests: [] as LeaveRow[],
    approvals: [] as ApprovalRow[],
    balances: [] as BalanceRow[],
    notifications: [] as NotificationRow[],
  };

  let bal = 0;
  for (const emp of employees) {
    for (const lt of leaveTypes) {
      const override = opts.balanceOverrides?.[emp.id]?.[lt.id];
      if (override === null) continue;
      const remaining = override ?? lt.defaultDays;
      state.balances.push({
        id: `bal-${++bal}`,
        employeeId: emp.id,
        leaveTypeId: lt.id,
        year: YEAR,
        totalDays: lt.defaultDays,
        usedDays: lt.defaultDays - remaining,
        remainingDays: remaining,
      });
    }
  }

  const userWithRole = (u: SeedUser) => ({
    id: u.id,
    email: u.email,
    role: { name: u.role },
  });
  const hydrateEmployee = (emp: SeedEmployee) => {
    const u = users.find((x) => x.id === emp.userId);
    return {
      id: emp.id,
      userId: emp.userId,
      firstName: emp.firstName,
      lastName: emp.lastName,
      departmentId: emp.departmentId,
      gender: emp.gender ?? null,
      hireDate: emp.hireDate,
      position: { name: emp.positionName },
      department: { id: emp.departmentId, name: emp.departmentId },
      user: u ? userWithRole(u) : null,
    };
  };
  const hydrateLeave = (row: LeaveRow) => {
    const emp = employees.find((x) => x.id === row.employeeId)!;
    return {
      ...row,
      days: [...row.days],
      leaveType: leaveTypes.find((t) => t.id === row.leaveTypeId)!,
      employee: hydrateEmployee(emp),
    };
  };
  const employeeMatches = (
    emp: SeedEmployee,
    where: Record<string, unknown> = {},
  ) => {
    const w = where as {
      userId?: string;
      departmentId?: string;
      user?: { role?: { name?: string } };
    };
    if (w.userId !== undefined && emp.userId !== w.userId) return false;
    if (w.departmentId !== undefined && emp.departmentId !== w.departmentId)
      return false;
    const roleName = w.user?.role?.name;
    if (roleName && users.find((u) => u.id === emp.userId)?.role !== roleName)
      return false;
    return true;
  };

  let seq = 0;
  const prisma = {
    state,
    employee: {
      findUnique: jest.fn(
        async ({ where }: { where: { userId?: string; id?: string } }) => {
          const emp = employees.find((x) =>
            where.userId ? x.userId === where.userId : x.id === where.id,
          );
          return emp ? hydrateEmployee(emp) : null;
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where?: Record<string, unknown> } = {}) =>
          employees
            .filter((x) => employeeMatches(x, where))
            .map(hydrateEmployee),
      ),
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const u = users.find((x) => x.id === where.id);
        return u ? userWithRole(u) : null;
      }),
      findMany: jest.fn(
        async ({ where }: { where?: { role?: { name?: string } } } = {}) =>
          users
            .filter((u) => !where?.role?.name || u.role === where.role.name)
            .map(userWithRole),
      ),
    },
    publicHoliday: { findMany: jest.fn(async () => [] as { date: Date }[]) },
    leaveRequest: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = state.leaveRequests.find((r) => r.id === where.id);
        return row ? hydrateLeave(row) : null;
      }),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string } }) => {
          const row = state.leaveRequests.find((r) => r.id === where.id);
          if (!row) throw new Error(`leaveRequest ${where.id} not found`);
          return { ...row };
        },
      ),
      findFirst: jest.fn(
        async ({ where }: { where?: Record<string, unknown> } = {}) => {
          const row = state.leaveRequests.find((r) =>
            matchWhere(r as unknown as Record<string, unknown>, where),
          );
          return row ? hydrateLeave(row) : null;
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where?: Record<string, unknown> } = {}) =>
          state.leaveRequests
            .filter((r) =>
              matchWhere(r as unknown as Record<string, unknown>, where),
            )
            .map(hydrateLeave),
      ),
      aggregate: jest.fn(
        async ({
          where,
          _sum,
        }: {
          where?: Record<string, unknown>;
          _sum: Record<string, boolean>;
        }) => {
          const field = Object.keys(_sum)[0] as keyof LeaveRow;
          const rows = state.leaveRequests.filter((r) =>
            matchWhere(r as unknown as Record<string, unknown>, where),
          );
          const total = rows.reduce((s, r) => s + Number(r[field] ?? 0), 0);
          return { _sum: { [field]: rows.length ? total : null } };
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const days =
          (
            data.days as
              { create?: { date: Date; portion: string }[] } | undefined
          )?.create ?? [];
        const row: LeaveRow = {
          id: `leave-${++seq}`,
          requestCode: (data.requestCode as string) ?? null,
          employeeId: data.employeeId as string,
          leaveTypeId: data.leaveTypeId as string,
          startDate: data.startDate as Date,
          endDate: data.endDate as Date,
          startFormat: (data.startFormat as string) ?? 'full',
          endFormat: (data.endFormat as string) ?? 'full',
          totalDays: data.totalDays as number,
          paidDays: (data.paidDays as number) ?? 0,
          unpaidDays: (data.unpaidDays as number) ?? 0,
          reason: (data.reason as string) ?? null,
          status: data.status as string,
          isViewedByHr: false,
          currentHrReviewerId: null,
          hrReviewStartedAt: null,
          createdAt: new Date(),
          days: days.map((d) => ({ date: d.date, portion: d.portion })),
        };
        state.leaveRequests.push(row);
        return { ...row };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = state.leaveRequests.find((r) => r.id === where.id);
          if (!row) throw new Error(`leaveRequest ${where.id} not found`);
          const { days, ...rest } = data;
          Object.assign(row, rest);
          if (days && typeof days === 'object' && 'create' in days) {
            row.days = (
              days as { create: { date: Date; portion: string }[] }
            ).create;
          }
          return { ...row };
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where?: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const rows = state.leaveRequests.filter((r) =>
            matchWhere(r as unknown as Record<string, unknown>, where),
          );
          rows.forEach((r) => Object.assign(r, data));
          return { count: rows.length };
        },
      ),
    },
    leaveApproval: {
      create: jest.fn(async ({ data }: { data: ApprovalRow }) => {
        state.approvals.push({ ...data, comment: data.comment ?? null });
        return { ...data };
      }),
    },
    leaveBalance: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: string;
              leaveTypeId: string;
              year: number;
            };
          };
        }) => {
          const k = where.employeeId_leaveTypeId_year;
          const b = state.balances.find(
            (x) =>
              x.employeeId === k.employeeId &&
              x.leaveTypeId === k.leaveTypeId &&
              x.year === k.year,
          );
          return b
            ? {
                ...b,
                leaveType: leaveTypes.find((t) => t.id === b.leaveTypeId),
              }
            : null;
        },
      ),
      findFirst: jest.fn(
        async ({ where }: { where?: Record<string, unknown> } = {}) => {
          const b = state.balances.find((x) =>
            matchWhere(x as unknown as Record<string, unknown>, where),
          );
          return b ? { ...b } : null;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<BalanceRow>;
        }) => {
          const b = state.balances.find((x) => x.id === where.id)!;
          Object.assign(b, data);
          return { ...b };
        },
      ),
    },
    notification: {
      create: jest.fn(async ({ data }: { data: NotificationRow }) => {
        state.notifications.push({ ...data });
        return { ...data };
      }),
    },
    $queryRaw: jest.fn(async () => []),
  };
  // Interactive transactions just run against the same in-memory state
  // (declared separately so `prisma` keeps its inferred type).
  return Object.assign(prisma, {
    $transaction: jest.fn((fn: (tx: typeof prisma) => unknown) =>
      Promise.resolve(fn(prisma)),
    ),
  });
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

/** NotificationService stand-in: records e-mails instead of sending them. */
export function createNotificationMock() {
  return { sendEmail: jest.fn(async () => undefined) };
}

// ---- convenience -------------------------------------------------------------
export function balanceOf(
  prisma: FakePrisma,
  employeeId: string,
  leaveTypeId: string,
) {
  return prisma.state.balances.find(
    (b) => b.employeeId === employeeId && b.leaveTypeId === leaveTypeId,
  );
}
export function leaveOf(prisma: FakePrisma, id: string) {
  return prisma.state.leaveRequests.find((r) => r.id === id)!;
}
export function approvalsOf(prisma: FakePrisma, id: string) {
  return prisma.state.approvals.filter((a) => a.leaveRequestId === id);
}
export function notificationsFor(prisma: FakePrisma, userId: string) {
  return prisma.state.notifications.filter((n) => n.userId === userId);
}
export function emailsTo(
  mail: ReturnType<typeof createNotificationMock>,
  to: string,
) {
  return (
    mail.sendEmail.mock.calls as unknown as [string, string, string][]
  ).filter((c) => c[0] === to);
}
