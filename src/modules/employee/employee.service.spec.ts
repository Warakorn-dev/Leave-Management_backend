/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/**
 * Focused coverage for the portion-aware availability endpoint. The pure
 * overlap logic is exhaustively tested in leave-portion.util.spec.ts; here we
 * check the service wires Prisma results into a correct per-day answer,
 * including self-exclusion when editing (TEST 11 & TEST 12 at the API layer).
 */
describe('EmployeeService.getDayAvailability', () => {
  let service: EmployeeService;
  let prisma: {
    employee: { findUnique: jest.Mock };
    leaveRequest: { findMany: jest.Mock };
    publicHoliday: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'emp-1',
          userId: 'user-1',
          hireDate: new Date('2020-01-01'),
          user: { role: { name: 'Employee' } },
        }),
      },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
      publicHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendEmail: jest.fn() } },
      ],
    }).compile();

    service = module.get(EmployeeService);
  });

  it('marks each day in the range independently around an existing half day', async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'leave-existing',
        startDate: new Date('2026-09-15'),
        endDate: new Date('2026-09-15'),
        startFormat: 'morning',
        endFormat: 'morning',
        leaveType: { name: 'ลาป่วย' },
      },
    ]);

    const res = await service.getDayAvailability(
      'user-1',
      '2026-09-14',
      '2026-09-16',
    );

    expect(res.data).toHaveLength(3);
    const [d14, d15, d16] = res.data;

    expect(d14.date).toBe('2026-09-14');
    expect(d14.status).toBe('available');
    expect(d14.morningTaken).toBe(false);
    expect(d14.afternoonTaken).toBe(false);

    expect(d15.date).toBe('2026-09-15');
    expect(d15.status).toBe('partial');
    expect(d15.morningTaken).toBe(true);
    expect(d15.afternoonTaken).toBe(false);

    expect(d16.status).toBe('available');
  });

  it('reports a fully booked day when both halves are taken', async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'a',
        startDate: new Date('2026-09-15'),
        endDate: new Date('2026-09-15'),
        startFormat: 'morning',
        endFormat: 'morning',
        leaveType: { name: 'ลากิจส่วนตัว' },
      },
      {
        id: 'b',
        startDate: new Date('2026-09-15'),
        endDate: new Date('2026-09-15'),
        startFormat: 'afternoon',
        endFormat: 'afternoon',
        leaveType: { name: 'ลาป่วย' },
      },
    ]);

    const res = await service.getDayAvailability(
      'user-1',
      '2026-09-15',
      '2026-09-15',
    );
    expect(res.data[0].status).toBe('full');
  });

  it('passes excludeRequestId through to Prisma so an edit never clashes with itself', async () => {
    await service.getDayAvailability(
      'user-1',
      '2026-09-15',
      '2026-09-15',
      'leave-123',
    );
    const calls = prisma.leaveRequest.findMany.mock.calls as Array<
      [{ where: { id?: { not?: string } } }]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].where.id).toEqual({ not: 'leave-123' });
  });

  it('rejects an invalid range', async () => {
    await expect(
      service.getDayAvailability('user-1', '2026-09-16', '2026-09-14'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
