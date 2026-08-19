import { Injectable, StreamableFile } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import * as PDFDocument from 'pdfkit';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ExportService {
  constructor(private prisma: PrismaService) {}

  async exportToExcel(res: Response) {
    const leaves = await this.prisma.leaveRequest.findMany({
      include: { employee: true, leaveType: true },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leave Requests');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 36 },
      { header: 'Employee Name', key: 'employeeName', width: 30 },
      { header: 'Leave Type', key: 'leaveType', width: 20 },
      { header: 'Start Date', key: 'startDate', width: 15 },
      { header: 'End Date', key: 'endDate', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
    ];

    leaves.forEach(leave => {
      worksheet.addRow({
        id: leave.id,
        employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
        leaveType: leave.leaveType.name,
        startDate: leave.startDate.toISOString().split('T')[0],
        endDate: leave.endDate.toISOString().split('T')[0],
        status: leave.status,
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=leave_report.xlsx');

    return workbook.xlsx.write(res).then(() => {
      res.status(200).end();
    });
  }

  async exportToPDF(res: Response) {
    const leaves = await this.prisma.leaveRequest.findMany({
      include: { employee: true, leaveType: true },
    });

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=leave_report.pdf');

    doc.pipe(res);

    const fontPath = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
    if (fs.existsSync(fontPath)) {
      doc.font(fontPath);
    }

    doc.fontSize(18).text('รายงานการลางาน (Leave Management Report)', { align: 'center' });
    doc.moveDown(1.5);

    leaves.forEach((leave, i) => {
      const empName = leave.employee ? `${leave.employee.firstName} ${leave.employee.lastName}` : 'พนักงาน';
      const leaveName = leave.leaveType?.name || 'ลางาน';
      const startDateStr = leave.startDate.toISOString().split('T')[0];
      const endDateStr = leave.endDate.toISOString().split('T')[0];

      doc.fontSize(12).text(`${i + 1}. ${empName} - ${leaveName}`);
      doc.fontSize(10).fillColor('#4B5563').text(`   วันที่: ${startDateStr} ถึง ${endDateStr} (${leave.totalDays} วัน) | สถานะ: ${leave.status}`);
      doc.fillColor('#000000');
      doc.moveDown(0.8);
    });

    doc.end();
  }
}
