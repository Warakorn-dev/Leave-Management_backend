const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfill() {
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      OR: [
        { requestCode: null },
        { requestCode: '' }
      ]
    },
    include: {
      leaveType: true
    },
    orderBy: {
      createdAt: 'asc' // process older ones first to keep sequence order
    }
  });

  console.log(`Found ${leaves.length} leave requests without requestCode.`);
  
  for (const leave of leaves) {
    const buddhistYear = leave.createdAt.getFullYear() + 543;
    const leaveTypeCode = leave.leaveType.code;
    
    const yearStart = new Date(`${buddhistYear - 543}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${buddhistYear - 543 + 1}-01-01T00:00:00.000Z`);

    const allRequests = await prisma.leaveRequest.findMany({
      where: {
        requestCode: { endsWith: `-${buddhistYear}` },
        createdAt: { gte: yearStart, lt: yearEnd },
      },
      select: { requestCode: true },
    });

    let nextSeq = 1;
    if (allRequests.length > 0) {
      const maxSeq = allRequests.reduce((max, req) => {
        if (req.requestCode) {
          const parts = req.requestCode.split('-');
          if (parts.length >= 3) {
            const seq = Number.parseInt(parts[2], 10);
            if (!Number.isNaN(seq) && seq > max) return seq;
          }
        }
        return max;
      }, 0);
      nextSeq = maxSeq + 1;
    }

    const requestCode = `L-${leaveTypeCode}-${String(nextSeq).padStart(5, '0')}-${buddhistYear}`;
    console.log(`Updating leave ${leave.id} with code ${requestCode}`);
    
    await prisma.leaveRequest.update({
      where: { id: leave.id },
      data: { requestCode }
    });
  }
  
  console.log("Backfill completed!");
  await prisma.$disconnect();
}

backfill().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
