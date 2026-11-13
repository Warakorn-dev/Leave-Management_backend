import { CeoService } from './ceo.service';

/**
 * Leave dates are stored at UTC midnight, which falls AFTER local midnight in
 * Asia/Bangkok. "On leave today" must therefore compare against the whole
 * local day [today, tomorrow), or a leave that starts today is missed.
 */
describe('CeoService "on leave today"', () => {
  const build = () => {
    const prisma = {
      employee: {
        count: jest.fn().mockResolvedValue(10),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      leaveRequest: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      announcement: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, ceo: new CeoService(prisma as never, {} as never) };
  };

  const todayWhere = (prisma: ReturnType<typeof build>['prisma']) =>
    prisma.leaveRequest.count.mock.calls
      .map(([arg]) => (arg ?? {}) as { where?: Record<string, unknown> })
      .find((arg) => arg.where?.status === 'APPROVED' && arg.where.endDate)!
      .where as { startDate: { lt: Date }; endDate: { gte: Date } };

  it.each([
    ['dashboard', (ceo: CeoService) => ceo.getDashboardStats('u-ceo')],
    ['report stats', (ceo: CeoService) => ceo.getReportStats()],
  ])('%s counts a leave starting today', async (_name, run) => {
    const { prisma, ceo } = build();
    await run(ceo);

    const { startDate, endDate } = todayWhere(prisma);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    expect(startDate.lt.getTime()).toBe(tomorrowStart.getTime());
    expect(endDate.gte.getTime()).toBe(todayStart.getTime());
  });
});
