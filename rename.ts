import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.department.updateMany({
    where: { name: 'IT' },
    data: { name: 'Engineering' }
  });
  console.log(`Updated ${result.count} department(s) to Engineering.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
