import { Injectable, StreamableFile } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import * as PDFDocument from 'pdfkit';
import { Response } from 'express';

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

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=leave_report.pdf');

    doc.pipe(res);
    doc.fontSize(20).text('Leave Management Report', { align: 'center' });
    doc.moveDown();

    leaves.forEach((leave, i) => {
      doc.fontSize(12).text(`${i + 1}. ${leave.employee.firstName} ${leave.employee.lastName} - ${leave.leaveType.name}`);
      doc.text(`   Dates: ${leave.startDate.toISOString().split('T')[0]} to ${leave.endDate.toISOString().split('T')[0]}`);
      doc.text(`   Status: ${leave.status}`);
      doc.moveDown();
    });

    doc.end();
  }
}
