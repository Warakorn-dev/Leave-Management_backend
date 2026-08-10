require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const balances = await prisma.leaveBalance.findMany({
    include: { leaveType: true }
  });
  console.log('Leave Balances:');
  console.log(balances.map(b => `${b.employeeId} - ${b.leaveType.name} - Year ${b.year} - Remaining ${b.remainingDays}`));

  const requests = await prisma.leaveRequest.findMany({
    include: { leaveType: true }
  });
  console.log('\nLeave Requests:');
  console.log(requests.map(r => `${r.employeeId} - ${r.leaveType?.name} - Status ${r.status} - Days ${r.totalDays}`));
}

main().finally(() => prisma.$disconnect());
