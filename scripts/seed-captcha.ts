const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const captchas: any[] = [];
  for (let i = 0; i < 20; i++) {
    const expiredAt = new Date();
    expiredAt.setFullYear(expiredAt.getFullYear() + 1);
    captchas.push({ captchaCode: Math.random().toString(36).substring(2, 7).toUpperCase(), expiredAt, isUsed: false });
  }
  await prisma.captcha.createMany({ data: captchas });
  console.log('Seeded 20 captchas');
}
main().catch(console.error).finally(() => prisma.$disconnect());
