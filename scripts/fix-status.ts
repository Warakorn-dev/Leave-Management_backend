import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const leaves = await prisma.leaveRequest.findMany({
    where: { status: 'Waiting CEO' },
    include: { employee: { include: { user: { include: { role: true } } } } }
  });

  let count = 0;
  for (const leave of leaves) {
    // If the employee is not a manager, they shouldn't be Waiting CEO
    if (leave.employee.user?.role?.name !== 'Manager' && leave.employee.user?.role?.name !== 'CEO') {
      await prisma.leaveRequest.update({
        where: { id: leave.id },
        data: { status: 'Approved' }
      });
      
      // Also update the approval log if there's any pending
      const approvals = await prisma.leaveApproval.findMany({
        where: { leaveRequestId: leave.id, status: 'Waiting CEO' }
      });
      
      for (const approval of approvals) {
        await prisma.leaveApproval.update({
           where: { id: approval.id },
           data: { status: 'Approved' }
        });
      }
      
      count++;
      console.log(`Updated leave ${leave.id} to Approved`);
    }
  }
  console.log(`Successfully updated ${count} records.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
