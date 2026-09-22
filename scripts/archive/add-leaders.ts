const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Fetching all departments...');
  const departments = await prisma.department.findMany({
    include: { positions: true }
  });

  for (const dept of departments) {
    const hasLeader = dept.positions.some(p => p.name.toLowerCase() === 'leader');
    if (!hasLeader) {
      console.log(`Adding "Leader" to department: ${dept.name}`);
      await prisma.position.create({
        data: {
          name: 'Leader',
          departmentId: dept.id
        }
      });
    } else {
      console.log(`Department "${dept.name}" already has a Leader position.`);
    }
  }

  console.log('Finished adding Leader positions.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
