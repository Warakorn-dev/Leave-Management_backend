require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.employee.findMany({ select: { id: true, employeeCode: true, firstName: true } }).then(console.log).finally(() => prisma.$disconnect());
