import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const reqs = await prisma.leaveRequest.findMany({
    include: {
      employee: {
        include: { department: true }
      }
    }
  });
  console.table(reqs.map(r => ({
    id: r.id.substring(0, 5),
    status: r.status,
    empName: `${r.employee.firstName} ${r.employee.lastName}`,
    dept: r.employee.department.name
  })));
}
main().finally(() => prisma.$disconnect());
