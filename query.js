const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function main() {
  const req = await prisma.leaveRequest.findUnique({
    where: { requestCode: 'L-01-00057-2569' },
    include: { attachments: true }
  });
  fs.writeFileSync('output.json', JSON.stringify(req, null, 2), 'utf-8');
}

main().finally(() => prisma.$disconnect());
