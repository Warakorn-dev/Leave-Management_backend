const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const leaveTypes = await prisma.$queryRawUnsafe("SELECT id, name FROM leavetype");
  console.log(leaveTypes);
}
main().finally(() => prisma.$disconnect());

