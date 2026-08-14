const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe("ALTER TABLE position ADD COLUMN roleId VARCHAR(191) NULL");
  console.log("Added roleId to position table");
}
main().finally(() => prisma.$disconnect());

