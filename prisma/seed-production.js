/* eslint-disable */
// Master data for a production database — roles, leave types, departments,
// positions and the first Admin account. Unlike seed.ts it never deletes
// anything and creates no mock employees/requests; rows that already exist are
// left untouched (so HR edits to leave-type quotas are not overwritten), which
// makes it safe to re-run.
//
// Usage (PowerShell, on the backend server after `npm run db:init`):
//   $env:ADMIN_EMAIL="admin@yourcompany.co.th"; $env:ADMIN_PASSWORD="<strong password>"
//   npm run db:seed:prod
// Public holidays are added by HR in the app (วันหยุดประจำปี).
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const ROLES = ['Employee', 'Manager', 'HR', 'CEO', 'Admin'];

// Same codes/quotas as prisma/seed.ts; codes are what the leave flow keys on.
const LEAVE_TYPES = [
  { code: '01', name: 'ลาป่วย', defaultDays: 30, requiresCertificate: true, isSpecial: false },
  { code: '02', name: 'ลากิจธุระอันจำเป็น', defaultDays: 3, requiresCertificate: false, isSpecial: false },
  { code: '03', name: 'ลาเพื่อคลอดบุตร', defaultDays: 120, requiresCertificate: true, isSpecial: true },
  { code: '04', name: 'ลาเพื่อช่วยเหลือภริยาคลอดบุตร', defaultDays: 15, requiresCertificate: true, isSpecial: true },
  { code: '05', name: 'ลาเพื่อทำหมัน', defaultDays: 365, requiresCertificate: true, isSpecial: true },
  { code: '06', name: 'ลาเพื่อรับราชการทหาร', defaultDays: 60, requiresCertificate: true, isSpecial: true },
  { code: '07', name: 'ลาพักผ่อนประจำปี (พักร้อน)', defaultDays: 6, requiresCertificate: false, isSpecial: true },
  { code: '08', name: 'ลาอุปสมบท', defaultDays: 120, requiresCertificate: true, isSpecial: true },
  { code: '09', name: 'ลาไปประกอบพิธีฮัจย์', defaultDays: 120, requiresCertificate: true, isSpecial: true },
];

const DEPARTMENTS = {
  'Human Resource Department': ['Leader', 'SSO', 'HR Office'],
  'Account & Finance Department': ['Leader', 'RD', 'Accounting & Finance'],
  'Administration Department': ['Leader', 'Office admin', 'Operator'],
  'Sales & Marketing Department': ['Leader', 'Graphic designer', 'Marketing Officer'],
  'Service & Support Department': ['Leader', 'Senior Technical Support', 'Technical Support'],
  'Software Development Department': ['Leader', 'SA & Senior Programmer', 'Programmer'],
  'Project Department': ['Leader', 'Senior Asistance Project Manager', 'Asistance Project Manager'],
};

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword.length < 10) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 10 characters) before seeding.');
  }

  for (const name of ROLES) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log(`Roles: ${ROLES.join(', ')}`);

  for (const leaveType of LEAVE_TYPES) {
    await prisma.leaveType.upsert({ where: { code: leaveType.code }, update: {}, create: leaveType });
  }
  console.log(`Leave types: ${LEAVE_TYPES.length}`);

  for (const [deptName, positions] of Object.entries(DEPARTMENTS)) {
    const dept = await prisma.department.upsert({
      where: { name: deptName },
      update: {},
      create: { name: deptName },
    });
    for (const posName of positions) {
      const exists = await prisma.position.findFirst({ where: { name: posName, departmentId: dept.id } });
      if (!exists) await prisma.position.create({ data: { name: posName, departmentId: dept.id } });
    }
  }
  console.log(`Departments: ${Object.keys(DEPARTMENTS).length}`);

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`Admin ${adminEmail} already exists — password not changed.`);
  } else {
    const adminRole = await prisma.role.findUnique({ where: { name: 'Admin' } });
    await prisma.user.create({
      data: {
        email: adminEmail,
        username: 'superadmin',
        passwordHash: await bcrypt.hash(adminPassword, 10),
        roleId: adminRole.id,
      },
    });
    console.log(`Admin created: ${adminEmail}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
