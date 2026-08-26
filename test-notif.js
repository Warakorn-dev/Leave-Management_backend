const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  const list = await prisma.notification.findMany();
  let bad = 0;
  for (const item of list) {
    if (!item.message || typeof item.message !== 'string') {
      console.log('BAD MESSAGE', item.id, typeof item.message);
      bad++;
    }
  }
  console.log('Total bad:', bad);
}
test().catch(console.error).finally(() => prisma.$disconnect());
