/// <reference types="jest" />
import { PassThrough } from 'stream';
import * as ExcelJS from 'exceljs';
import { ExportService } from './export.service';

const LEAVES = [
  {
    id: 'leave-1',
    status: 'APPROVED',
    startDate: new Date('2026-10-05T00:00:00Z'),
    endDate: new Date('2026-10-06T00:00:00Z'),
    employee: { firstName: 'สมหญิง', lastName: 'ใจดี' },
    leaveType: { name: 'ลาป่วย' },
  },
  {
    id: 'leave-2',
    status: 'REJECTED',
    startDate: new Date('2026-11-02T00:00:00Z'),
    endDate: new Date('2026-11-02T00:00:00Z'),
    employee: { firstName: 'วิไล', lastName: 'ดีงาม' },
    leaveType: { name: 'ลากิจ' },
  },
];

/** An Express-like response that is also a writable stream, capturing the bytes. */
function fakeResponse() {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve) => stream.on('end', resolve));
  const res = Object.assign(stream, {
    headers: {},
    statusCode: 0,
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  });
  return { res, body: async () => (await finished, Buffer.concat(chunks)) };
}

let prisma: { leaveRequest: { findMany: jest.Mock } };
let service: ExportService;
beforeEach(() => {
  prisma = { leaveRequest: { findMany: jest.fn().mockResolvedValue(LEAVES) } };
  service = new ExportService(prisma as never);
});

describe('ExportService.exportToExcel', () => {
  it('writes one row per leave with the right columns and download headers', async () => {
    const { res, body } = fakeResponse();
    await service.exportToExcel(res as never);
    const bytes = await body();

    expect(res.headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename=leave_report.xlsx',
    );
    expect(res.statusCode).toBe(200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as never);
    const ws = wb.getWorksheet('Leave Requests')!;
    const rows = ws.getSheetValues().filter(Boolean) as unknown[][];
    expect(rows[0].slice(1)).toEqual([
      'ID',
      'Employee Name',
      'Leave Type',
      'Start Date',
      'End Date',
      'Status',
    ]);
    expect(rows.slice(1).map((r) => r.slice(1))).toEqual([
      [
        'leave-1',
        'สมหญิง ใจดี',
        'ลาป่วย',
        '2026-10-05',
        '2026-10-06',
        'APPROVED',
      ],
      [
        'leave-2',
        'วิไล ดีงาม',
        'ลากิจ',
        '2026-11-02',
        '2026-11-02',
        'REJECTED',
      ],
    ]);
  });

  it('exports every leave: the service applies no filter (all statuses, all employees)', async () => {
    const { res, body } = fakeResponse();
    await service.exportToExcel(res as never);
    await body();
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith({
      include: { employee: true, leaveType: true },
    });
  });

  it('an empty database still produces a valid sheet with only the header', async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([]);
    const { res, body } = fakeResponse();
    await service.exportToExcel(res as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await body()) as never);
    expect(wb.getWorksheet('Leave Requests')!.rowCount).toBe(1);
  });

  it('a database error is propagated and nothing is sent', async () => {
    prisma.leaveRequest.findMany.mockRejectedValue(new Error('db down'));
    const { res } = fakeResponse();
    await expect(service.exportToExcel(res as never)).rejects.toThrow(
      'db down',
    );
    expect(res.headers).toEqual({});
  });
});

describe('ExportService.exportToPDF', () => {
  it('streams a PDF document with download headers', async () => {
    const { res, body } = fakeResponse();
    await service.exportToPDF(res as never);
    const bytes = await body();
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename=leave_report.pdf',
    );
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
