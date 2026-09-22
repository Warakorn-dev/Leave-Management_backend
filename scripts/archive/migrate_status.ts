import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.leaveRequest.updateMany({ where: { status: 'Pending' }, data: { status: 'PENDING_VERIFY' } });
  await prisma.leaveRequest.updateMany({ where: { status: 'Waiting Manager' }, data: { status: 'PENDING_SUPERVISOR' } });
  await prisma.leaveRequest.updateMany({ where: { status: 'Waiting CEO' }, data: { status: 'PENDING_EXECUTIVE' } });
  await prisma.leaveRequest.updateMany({ where: { status: 'Approved' }, data: { status: 'APPROVED' } });
  await prisma.leaveRequest.updateMany({ where: { status: { in: ['Rejected', 'Rejected Manager', 'Rejected CEO'] } }, data: { status: 'REJECTED' } });
  
  await prisma.leaveApproval.updateMany({ where: { status: 'Pending' }, data: { status: 'PENDING_VERIFY' } });
  await prisma.leaveApproval.updateMany({ where: { status: 'Waiting Manager' }, data: { status: 'PENDING_SUPERVISOR' } });
  await prisma.leaveApproval.updateMany({ where: { status: 'Waiting CEO' }, data: { status: 'PENDING_EXECUTIVE' } });
  await prisma.leaveApproval.updateMany({ where: { status: 'Approved' }, data: { status: 'APPROVED' } });
  await prisma.leaveApproval.updateMany({ where: { status: { in: ['Rejected', 'Rejected Manager', 'Rejected CEO'] } }, data: { status: 'REJECTED' } });

  console.log('Migration complete');
}
main().catch(console.error).finally(() => prisma.$disconnect());
