const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const depts = await prisma.department.findMany({ include: { positions: true } });
  const emps = await prisma.employee.findMany({ include: { department: true, position: true } });
  
  console.log('Depts:', JSON.stringify(depts, null, 2));
  console.log('Emps:', JSON.stringify(emps.map(e => ({ id: e.id, name: e.firstName + ' ' + e.lastName, dept: e.department?.name, pos: e.position?.name })), null, 2));
}

main().finally(() => prisma.$disconnect());
