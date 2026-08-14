const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const hrUser = await prisma.user.findFirst({
    where: { role: { name: "HR" } },
    include: { role: true }
  });
  
  if (!hrUser) {
    console.log("No HR user found");
    return;
  }
  
  // Login to get token
  const res = await fetch("http://localhost:8000/api/auth/captcha");
  const data = (await res.json()).data;
  const captcha = await prisma.captcha.findUnique({ where: { id: data.captcha_id } });
  
  const loginRes = await fetch("http://localhost:8000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: hrUser.username || hrUser.email,
      password: "password123", // Assuming default password
      captchaId: data.captcha_id,
      captchaInput: captcha.captchaCode
    })
  });
  
  const loginData = await loginRes.json();
  if (!loginData.accessToken) {
    console.log("Login failed", loginData);
    return;
  }
  
  // Fetch dashboard stats
  const dashboardRes = await fetch("http://localhost:8000/api/hr/dashboard", {
    headers: { "Authorization": `Bearer ${loginData.accessToken}` }
  });
  
  console.log("Status:", dashboardRes.status);
  console.log(await dashboardRes.text());
}
main().finally(() => prisma.$disconnect());

