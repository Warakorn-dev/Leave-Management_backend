const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const leaves = await prisma.leaveRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 2 });
  console.log(leaves);
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
