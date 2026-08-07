import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('Seeding Mock Leave History...');
    const employee = await prisma.employee.findFirst({
        where: { firstName: 'Admin', lastName: 'CEO' },
    });
    
    if (!employee) {
        console.error('Employee not found. Please make sure you have users in the DB.');
        return;
    }

    const sickLeave = await prisma.leaveType.findFirst({ where: { name: 'ลาป่วย' } });
    const vacationLeave = await prisma.leaveType.findFirst({ where: { name: 'ลาพักร้อน' } });

    if (!sickLeave || !vacationLeave) {
        console.error('Leave types not found.');
        return;
    }

    const requests = [
        {
            employeeId: employee.id,
            leaveTypeId: sickLeave.id,
            startDate: new Date('2024-05-10T00:00:00Z'),
            endDate: new Date('2024-05-11T00:00:00Z'),
            totalDays: 2,
            reason: 'ไข้หวัดใหญ่ ต้องพักผ่อนตามแพทย์สั่ง',
            status: 'Approved',
        },
        {
            employeeId: employee.id,
            leaveTypeId: vacationLeave.id,
            startDate: new Date('2024-12-25T00:00:00Z'),
            endDate: new Date('2024-12-27T00:00:00Z'),
            totalDays: 3,
            reason: 'พักผ่อนปลายปี',
            status: 'Pending',
        },
        {
            employeeId: employee.id,
            leaveTypeId: sickLeave.id,
            startDate: new Date('2024-02-14T00:00:00Z'),
            endDate: new Date('2024-02-14T00:00:00Z'),
            totalDays: 1,
            reason: 'อาหารเป็นพิษ',
            status: 'Rejected',
        }
    ];

    for (const req of requests) {
        await prisma.leaveRequest.create({
            data: req as any,
        });
        console.log(`Created mock leave request: ${req.reason} (${req.status})`);
    }

    console.log('Successfully created mock leave requests!');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
