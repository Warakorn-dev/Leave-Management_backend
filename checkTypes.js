const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const types = await prisma.leaveType.findMany({ select: { name: true, isSpecial: true } });
  console.log(types);
}

main().catch(console.error).finally(() => prisma.$disconnect());
