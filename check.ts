const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$queryRawUnsafe('SHOW TABLES').then(console.log).finally(() => prisma.$disconnect());
