const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.adminSetting.findMany().then(console.log).finally(() => prisma.$disconnect());
