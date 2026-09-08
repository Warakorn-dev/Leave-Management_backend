const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Admin role and user...');
  
  // 1. Create Admin Role
  let adminRole = await prisma.role.findUnique({ where: { name: 'Admin' } });
  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: { name: 'Admin' }
    });
    console.log('✅ Created Admin Role');
  } else {
    console.log('ℹ️ Admin Role already exists');
  }

  // 2. Create Super Admin User
  const adminEmail = 'admin@admin.com';
  let adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    const passwordHash = await bcrypt.hash('admin1234', 10);
    adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        username: 'superadmin',
        passwordHash,
        roleId: adminRole.id,
      }
    });
    console.log(`✅ Created Super Admin User (Email: ${adminEmail} / Pass: admin1234)`);
  } else {
    console.log('ℹ️ Super Admin User already exists');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

