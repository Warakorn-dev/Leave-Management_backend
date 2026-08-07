import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
  const svgCaptcha = require('svg-captcha');
  const captcha = svgCaptcha.create({
    size: 5,
    noise: 2,
    color: true,
    background: '#222',
    width: 150,
    height: 50,
  });

  console.log("Captcha generated:", captcha.text);

  const expiredAt = new Date();
  expiredAt.setMinutes(expiredAt.getMinutes() + 10);

  const newCaptcha = await prisma.captcha.create({
    data: {
      captchaCode: captcha.text,
      isUsed: false,
      expiredAt: expiredAt,
    }
  });

  console.log("Captcha saved:", newCaptcha.id);
}

test().catch(console.error).finally(() => prisma.$disconnect());
