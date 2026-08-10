const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const emp = await prisma.user.findUnique({
    where: { email: 'dev2@company.com' },
    include: {
      employee: {
        include: {
          leaveBalances: {
            include: { leaveType: true }
          }
        }
      }
    }
  });
  console.log(JSON.stringify(emp, null, 2));
}

main().finally(() => prisma.$disconnect());
