const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const types = await prisma.$queryRawUnsafe("SELECT id FROM leavetype");
  for (let i = 0; i < types.length; i++) {
    const code = String(i + 1).padStart(2, "0");
    await prisma.$executeRawUnsafe(`UPDATE leavetype SET code = "${code}" WHERE id = "${types[i].id}"`);
  }
  console.log("Populated code column");
}
main().finally(() => prisma.$disconnect());

