const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employee: {
        firstName: 'วิไล'
      }
    }
  });
  console.log(leaves);
}
main().catch(console.error).finally(() => prisma.$disconnect());
