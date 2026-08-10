const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const employees = await prisma.employee.findMany();
  console.log('Employees:');
  console.log(employees.map(e => `${e.firstName} ${e.lastName} - Code: '${e.employeeCode}'`));
}

main().finally(() => prisma.$disconnect());
