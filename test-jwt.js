const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
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
  
  const secret = process.env.JWT_SECRET || "defaultSecret";
  const token = jwt.sign({ sub: hrUser.id, email: hrUser.email, role: hrUser.role.name }, secret, { expiresIn: "15m" });
  
  const dashboardRes = await fetch("http://localhost:8000/api/hr/dashboard", {
    headers: { "Authorization": "Bearer " + token }
  });
  
  console.log("Status:", dashboardRes.status);
  const text = await dashboardRes.text();
  console.log(text);
}
main().finally(() => prisma.$disconnect());

