const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe("ALTER TABLE leaverequest CHANGE leaveCode requestCode VARCHAR(20) NULL");
  console.log("Renamed leaveCode to requestCode");
}
main().finally(() => prisma.$disconnect());

