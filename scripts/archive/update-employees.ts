import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateEmployees() {
  const updates = [
    { first: 'สายฝน', last: 'โค้ดดิ้ง', dept: 'Software Development Department', pos: 'SA & Senior Programmer' },
    { first: 'มาลี', last: 'ขายเก่ง', dept: 'Sales & Marketing Department', pos: 'Leader' },
    { first: 'เอกพงศ์', last: 'ผู้นำทีม', dept: 'Software Development Department', pos: 'Leader' },
    { first: 'วิไล', last: 'ใจดี', dept: 'Human Resource Department', pos: 'Leader' },
    { first: 'สมศักดิ์', last: 'พนักงานดีเด่น', dept: 'Software Development Department', pos: 'Programmer' }
  ];

  for (const update of updates) {
    const dept = await prisma.department.findFirst({ where: { name: update.dept } });
    if (!dept) {
      console.log(`Department not found: ${update.dept}`);
      continue;
    }
    const pos = await prisma.position.findFirst({ where: { name: update.pos, departmentId: dept.id } });
    if (!pos) {
      console.log(`Position not found: ${update.pos} in ${update.dept}`);
      continue;
    }
    
    const emp = await prisma.employee.findFirst({ where: { firstName: update.first, lastName: update.last } });
    if (!emp) {
      console.log(`Employee not found: ${update.first} ${update.last}`);
      continue;
    }

    await prisma.employee.update({
      where: { id: emp.id },
      data: { departmentId: dept.id, positionId: pos.id }
    });
    console.log(`Updated ${update.first} ${update.last} to ${update.dept} - ${update.pos}`);
  }

  // Handle CEO separately
  const ceoEmp = await prisma.employee.findFirst({ where: { firstName: 'สมชาย', lastName: 'ยอดบริหาร' } });
  if (ceoEmp) {
    // Find CEO position. Does it have a department? Let's check
    let ceoPos = await prisma.position.findFirst({ where: { name: 'Chief Executive Officer' } });
    if (!ceoPos) {
       ceoPos = await prisma.position.findFirst({ where: { name: 'CEO' } });
    }
    if (ceoPos) {
       await prisma.employee.update({
         where: { id: ceoEmp.id },
         data: { positionId: ceoPos.id, departmentId: ceoPos.departmentId || ceoEmp.departmentId }
       });
       console.log(`Updated สมชาย ยอดบริหาร to position ${ceoPos.name}`);
    } else {
       console.log(`CEO position not found for สมชาย ยอดบริหาร`);
    }
  } else {
    console.log(`Employee not found: สมชาย ยอดบริหาร`);
  }
}

updateEmployees()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
