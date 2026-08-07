import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const reqs = await prisma.leaveRequest.findMany({
    where: {
      reason: { contains: 'ไปหามารดา' }
    },
    include: {
      approvals: true
    }
  });
  console.log('Requests:', JSON.stringify(reqs, null, 2));
}
main().finally(() => prisma.$disconnect());
