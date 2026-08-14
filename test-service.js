const { PrismaClient } = require("@prisma/client");
const { HrService } = require("./dist/modules/hr/hr.service.js");
const prisma = new PrismaClient();

async function main() {
  const hrUser = await prisma.user.findFirst({
    where: { role: { name: "HR" } },
    include: { role: true }
  });
  
  if (!hrUser) {
    console.log("No HR user found");
    return;
  }
  
  const hrService = new HrService(prisma, null);
  try {
    const stats = await hrService.getDashboardStats(hrUser.id);
    console.log("Success:", stats);
  } catch (err) {
    console.error("Error:", err);
  }
}
main().finally(() => prisma.$disconnect());

