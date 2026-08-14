const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const res = await fetch("http://localhost:8000/api/auth/captcha");
  const data = (await res.json()).data;
  const captcha = await prisma.captcha.findUnique({ where: { id: data.captcha_id } });
  
  const loginRes = await fetch("http://localhost:8000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "nonexistentuser",
      password: "password",
      captchaId: data.captcha_id,
      captchaInput: captcha.captchaCode
    })
  });
  console.log(loginRes.status);
  console.log(await loginRes.text());
}
main().finally(() => prisma.$disconnect());

