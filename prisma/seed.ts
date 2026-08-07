import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing old data (Resetting Database)...');
  
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.leaveApproval.deleteMany();
  await prisma.leaveAttachment.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.leaveBalance.deleteMany();
  await prisma.publicHoliday.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.user.deleteMany();
  await prisma.position.deleteMany();
  await prisma.department.deleteMany();
  await prisma.leaveType.deleteMany();
  await prisma.role.deleteMany();

  console.log('Seeding Realistic Data...');

  // 1. Roles
  const roles = await Promise.all([
    prisma.role.create({ data: { name: 'Employee' } }),
    prisma.role.create({ data: { name: 'Manager' } }),
    prisma.role.create({ data: { name: 'HR' } }),
    prisma.role.create({ data: { name: 'CEO' } }),
  ]);
  const roleMap = { Employee: roles[0], Manager: roles[1], HR: roles[2], CEO: roles[3] };

  // 2. Departments
  const depts = await Promise.all([
    prisma.department.create({ data: { name: 'Human Resource Department' } }),
    prisma.department.create({ data: { name: 'Account & Finance Department' } }),
    prisma.department.create({ data: { name: 'Administration Department' } }),
    prisma.department.create({ data: { name: 'Sales & Marketing Department' } }),
    prisma.department.create({ data: { name: 'Service & Support Department' } }),
    prisma.department.create({ data: { name: 'Software Development Department' } }),
    prisma.department.create({ data: { name: 'Project Department' } }),
  ]);
  const deptMap = { 
    HR: depts[0], 
    Finance: depts[1], 
    Admin: depts[2], 
    Sales: depts[3], 
    Support: depts[4], 
    IT: depts[5], 
    Project: depts[6], 
  };

  // 3. Positions
  const positions = await Promise.all([
    // Human Resource Department
    prisma.position.create({ data: { name: 'Leader', departmentId: depts[0].id } }),
    prisma.position.create({ data: { name: 'SSO', departmentId: depts[0].id } }),
    prisma.position.create({ data: { name: 'HR Office', departmentId: depts[0].id } }),
    // Account & Finance Department
    prisma.position.create({ data: { name: 'Leader', departmentId: depts[1].id } }),
    prisma.position.create({ data: { name: 'RD', departmentId: depts[1].id } }),
    prisma.position.create({ data: { name: 'Accounting & Finance', departmentId: depts[1].id } }),
    // Administration Department
    prisma.position.create({ data: { name: 'Leader', departmentId: depts[2].id } }),
    prisma.position.create({ data: { name: 'Office admin', departmentId: depts[2].id } }),
    prisma.position.create({ data: { name: 'Operator', departmentId: depts[2].id } }),
    // Sales & Marketing Department
    prisma.position.create({ data: { name: 'Leader', departmentId: depts[3].id } }),
    prisma.position.create({ data: { name: 'Graphic designer', departmentId: depts[3].id } }),
    prisma.position.create({ data: { name: 'Marketing Officer', departmentId: depts[3].id } }),
    // Service & Support Department
    prisma.position.create({ data: { name: 'Leader', departmentId: depts[4].id } }),
    prisma.position.create({ data: { name: 'Senior Technical Support', departmentId: depts[4].id } }),
    prisma.position.create({ data: { name: 'Technical Support', departmentId: depts[4].id } }),
    // Software Development Department
    prisma.position.create({ data: { name: 'Leader', departmentId: depts[5].id } }),
    prisma.position.create({ data: { name: 'SA & Senior Programmer', departmentId: depts[5].id } }),
    prisma.position.create({ data: { name: 'Programmer', departmentId: depts[5].id } }),
    // Project Department
    prisma.position.create({ data: { name: 'Leader', departmentId: depts[6].id } }),
    prisma.position.create({ data: { name: 'Senior Asistance Project Manager', departmentId: depts[6].id } }),
    prisma.position.create({ data: { name: 'Asistance Project Manager', departmentId: depts[6].id } }),
  ]);
  const posMap = {
    LeaderHR: positions[0],
    HROfficer: positions[2],
    LeaderFinance: positions[3],
    LeaderAdmin: positions[6],
    LeaderSales: positions[9],
    LeaderSupport: positions[12],
    LeaderIT: positions[15],
    Dev: positions[17],
    LeaderProject: positions[18],
  };

  // 4. Leave Types
  const leaveTypes = await Promise.all([
    prisma.leaveType.create({ data: { name: 'ลาป่วย', defaultDays: 30, requiresCertificate: true, isSpecial: false } }),
    prisma.leaveType.create({ data: { name: 'ลาเพื่อคลอดบุตร', defaultDays: 120, requiresCertificate: true, isSpecial: true } }),
    prisma.leaveType.create({ data: { name: 'ลาเพื่อช่วยเหลือภริยาคลอดบุตร', defaultDays: 15, requiresCertificate: true, isSpecial: true } }),
    prisma.leaveType.create({ data: { name: 'ลากิจธุระอันจำเป็น', defaultDays: 3, requiresCertificate: false, isSpecial: false } }),
    prisma.leaveType.create({ data: { name: 'ลาเพื่อทำหมัน', defaultDays: 365, requiresCertificate: true, isSpecial: true } }),
    prisma.leaveType.create({ data: { name: 'ลาเพื่อรับราชการทหาร', defaultDays: 60, requiresCertificate: true, isSpecial: true } }),
    prisma.leaveType.create({ data: { name: 'ลาพักผ่อนประจำปี (พักร้อน)', defaultDays: 6, requiresCertificate: false, isSpecial: false } }),
  ]);

  // 5. Users & Employees
  const defaultPassword = await bcrypt.hash('password1234', 10);
  const currentYear = new Date().getFullYear();

  const createEmployee = async (
    email: string,
    firstName: string,
    lastName: string,
    role: any,
    dept: any,
    pos: any
  ) => {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: defaultPassword,
        roleId: role.id,
      }
    });

    const emp = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName,
        lastName,
        phone: `08${Math.floor(Math.random() * 100000000)}`,
        departmentId: dept.id,
        positionId: pos.id,
        hireDate: new Date(`202${Math.floor(Math.random() * 4)}-0${Math.floor(Math.random() * 8) + 1}-01T00:00:00Z`),
      }
    });

    // Seed Leave Balances
    for (const lt of leaveTypes) {
      await prisma.leaveBalance.create({
        data: {
          employeeId: emp.id,
          leaveTypeId: lt.id,
          year: currentYear,
          totalDays: lt.defaultDays,
          usedDays: 0,
          remainingDays: lt.defaultDays,
        }
      });
    }

    return { user, emp };
  };

  const ceo = await createEmployee('ceo@company.com', 'สมชาย', 'ยอดบริหาร', roleMap.CEO, depts[6], posMap.LeaderProject);
  const hrMgr = await createEmployee('hrmanager@company.com', 'วิไล', 'ใจดี', roleMap.HR, depts[0], posMap.LeaderHR);
  const engMgr = await createEmployee('manager@company.com', 'เอกพงศ์', 'ผู้นำทีม', roleMap.Manager, depts[5], posMap.LeaderIT);
  const user1 = await createEmployee('user@company.com', 'สมศักดิ์', 'พนักงานดีเด่น', roleMap.Employee, depts[5], posMap.Dev);
  const user2 = await createEmployee('dev2@company.com', 'สายฝน', 'โค้ดดิ้ง', roleMap.Employee, depts[5], positions[16]); // SA & Senior Programmer
  const user3 = await createEmployee('sales1@company.com', 'มาลี', 'ขายเก่ง', roleMap.Employee, depts[3], positions[11]); // Marketing Officer

  // 6. Public Holidays
  const yearsToSeed = [currentYear, currentYear + 1];
  for (const year of yearsToSeed) {
    const makhaBuchaDate = year === 2026 ? '03-03' : '02-20';
    const visakhaBuchaDate = year === 2026 ? '05-31' : '05-20';
    const asarnhaBuchaDate = year === 2026 ? '07-29' : '07-18';
    const khaoPhansaDate = year === 2026 ? '07-30' : '07-19';

    await prisma.publicHoliday.createMany({
      data: [
        { name: 'วันขึ้นปีใหม่', date: new Date(`${year}-01-01T00:00:00Z`) },
        { name: 'วันมาฆบูชา', date: new Date(`${year}-${makhaBuchaDate}T00:00:00Z`) },
        { name: 'วันจักรี', date: new Date(`${year}-04-06T00:00:00Z`) },
        { name: 'วันสงกรานต์', date: new Date(`${year}-04-13T00:00:00Z`) },
        { name: 'วันสงกรานต์', date: new Date(`${year}-04-14T00:00:00Z`) },
        { name: 'วันสงกรานต์', date: new Date(`${year}-04-15T00:00:00Z`) },
        { name: 'วันแรงงานแห่งชาติ', date: new Date(`${year}-05-01T00:00:00Z`) },
        { name: 'วันฉัตรมงคล', date: new Date(`${year}-05-04T00:00:00Z`) },
        { name: 'วันวิสาขบูชา', date: new Date(`${year}-${visakhaBuchaDate}T00:00:00Z`) },
        { name: 'วันเฉลิมฯ พระราชินี', date: new Date(`${year}-06-03T00:00:00Z`) },
        { name: 'วันเฉลิมพระชนมพรรษา ร.10', date: new Date(`${year}-07-28T00:00:00Z`) },
        { name: 'วันอาสาฬหบูชา', date: new Date(`${year}-${asarnhaBuchaDate}T00:00:00Z`) },
        { name: 'วันเข้าพรรษา', date: new Date(`${year}-${khaoPhansaDate}T00:00:00Z`) },
        { name: 'วันแม่แห่งชาติ', date: new Date(`${year}-08-12T00:00:00Z`) },
        { name: 'วันคล้ายวันสวรรคต ร.9', date: new Date(`${year}-10-13T00:00:00Z`) },
        { name: 'วันปิยมหาราช', date: new Date(`${year}-10-23T00:00:00Z`) },
        { name: 'วันพ่อแห่งชาติ', date: new Date(`${year}-12-05T00:00:00Z`) },
        { name: 'วันรัฐธรรมนูญ', date: new Date(`${year}-12-10T00:00:00Z`) },
        { name: 'วันสิ้นปี', date: new Date(`${year}-12-31T00:00:00Z`) },
      ],
      skipDuplicates: true
    });
  }

  // 7. Leave Requests & Approvals
  const createLeaveRequest = async (
    empId: string, 
    ltName: string, 
    status: string, 
    reason: string, 
    days: number,
    approverId?: string
  ) => {
    const lt = leaveTypes.find(l => l.name === ltName);
    if (!lt) return;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + Math.floor(Math.random() * 20) - 10); // randomly in past or future
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days - 1);

    const req = await prisma.leaveRequest.create({
      data: {
        employeeId: empId,
        leaveTypeId: lt.id,
        startDate,
        endDate,
        totalDays: days,
        reason,
        status,
      }
    });

    if (approverId && (status === 'Approved' || status === 'Rejected')) {
      await prisma.leaveApproval.create({
        data: {
          leaveRequestId: req.id,
          approverId,
          status,
          comment: status === 'Approved' ? 'อนุมัติเรียบร้อยครับ' : 'ไม่อนุมัติเนื่องจากงานโปรเจกต์กำลังเร่งรัด',
        }
      });
      // Deduct balance if approved
      if (status === 'Approved') {
        const bal = await prisma.leaveBalance.findFirst({
          where: { employeeId: empId, leaveTypeId: lt.id, year: currentYear }
        });
        if (bal) {
          await prisma.leaveBalance.update({
            where: { id: bal.id },
            data: {
              usedDays: bal.usedDays + days,
              remainingDays: bal.remainingDays - days,
            }
          });
        }
      }
    }
    return req;
  };

  // user1 requests
  await createLeaveRequest(user1.emp.id, 'ลาพักผ่อนประจำปี (พักร้อน)', 'Approved', 'พักผ่อนไปเที่ยวเชียงใหม่กับครอบครัว', 3, engMgr.user.id);
  await createLeaveRequest(user1.emp.id, 'ลาป่วย', 'Approved', 'ไข้หวัดใหญ่ มีใบรับรองแพทย์', 2, engMgr.user.id);
  await createLeaveRequest(user1.emp.id, 'ลากิจธุระอันจำเป็น', 'Pending', 'ไปติดต่อราชการเรื่องทำบัตรประชาชนใหม่', 1);

  // user2 requests
  await createLeaveRequest(user2.emp.id, 'ลาป่วย', 'Rejected', 'ปวดหัวนิดหน่อย ไม่ไปหาหมอ', 1, engMgr.user.id);
  await createLeaveRequest(user2.emp.id, 'ลาพักผ่อนประจำปี (พักร้อน)', 'Pending', 'พักผ่อนอยู่บ้าน', 2);

  // user3 requests
  await createLeaveRequest(user3.emp.id, 'ลาเพื่อคลอดบุตร', 'Waiting CEO', 'เตรียมตัวคลอดลูกเดือนหน้า', 90);

  // engMgr requests
  await createLeaveRequest(engMgr.emp.id, 'ลาพักผ่อนประจำปี (พักร้อน)', 'Approved', 'ไปเที่ยวต่างประเทศ', 5, ceo.user.id);

  // 8. Notifications
  await prisma.notification.createMany({
    data: [
      { userId: user1.user.id, title: 'ระบบ Leave Management', message: 'ยินดีต้อนรับเข้าสู่ระบบจัดการวันลา' },
      { userId: user1.user.id, title: 'การลาถูกอนุมัติ', message: 'รายการลาพักร้อน 3 วัน ของคุณได้รับการอนุมัติแล้ว' },
      { userId: engMgr.user.id, title: 'คำขอลาใหม่', message: 'สมศักดิ์ พนักงานดีเด่น ส่งคำขอลากิจใหม่ 1 วัน โปรดตรวจสอบ' },
    ]
  });

  // 9. Audit Logs
  await prisma.auditLog.createMany({
    data: [
      { userId: user1.user.id, action: 'LOGIN', entity: 'Auth', details: 'User logged in successfully' },
      { userId: engMgr.user.id, action: 'APPROVE_LEAVE', entity: 'LeaveRequest', details: 'Approved leave request for user1' },
    ]
  });

  console.log('Database Seeding Completed Successfully! 🌱');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
