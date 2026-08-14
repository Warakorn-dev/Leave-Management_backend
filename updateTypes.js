const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.leaveType.updateMany({
    where: {
      name: {
        notIn: ['ลาป่วย', 'ลากิจธุระอันจำเป็น']
      }
    },
    data: { isSpecial: true }
  });
  
  await prisma.leaveType.updateMany({
    where: {
      name: {
        in: ['ลาป่วย', 'ลากิจธุระอันจำเป็น']
      }
    },
    data: { isSpecial: false }
  });

  const types = await prisma.leaveType.findMany({ select: { name: true, isSpecial: true } });
  console.log('Updated types:', types);
}

main().catch(console.error).finally(() => prisma.$disconnect());
