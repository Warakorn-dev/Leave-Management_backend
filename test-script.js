const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const reqs = await prisma.leaveRequest.findMany({
    where: { employee: { firstName: 'สายฝน' } },
    include: { employee: true, leaveType: true }
  });
  console.log(JSON.stringify(reqs, null, 2));
}
main().finally(() => prisma.$disconnect());
