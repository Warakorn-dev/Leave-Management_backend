import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'manager@company.com' } });
  if (!user) return console.log('Manager not found');
  
  const emp = await prisma.employee.findUnique({ where: { userId: user.id } });
  console.log('Manager dept:', emp?.departmentId);
  
  const reqs = await prisma.leaveRequest.findMany({
    where: {
      status: 'Pending',
      employee: {
        departmentId: emp?.departmentId,
      }
    }
  });
  console.log('Pending reqs found:', reqs.length);
}
main().finally(() => prisma.$disconnect());
