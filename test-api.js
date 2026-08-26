const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  try {
    const list = await prisma.user.findUnique({
      where: { id: undefined },
    });
    console.log('Success');
  } catch (e) {
    console.log('Error:', e.message);
  }
}
test().catch(console.error).finally(() => prisma.$disconnect());

