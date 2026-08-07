const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({
    select: { id: true, username: true, avatarUrl: true }
  });
  const withAvatar = users.filter(u => u.avatarUrl);
  console.log('Users WITH avatar (' + withAvatar.length + '):');
  withAvatar.forEach(u => console.log('  ' + (u.username || u.id) + ' -> ' + u.avatarUrl));
  
  const withoutAvatar = users.filter(u => !u.avatarUrl);
  console.log('Users WITHOUT avatar (' + withoutAvatar.length + '):');
  withoutAvatar.forEach(u => console.log('  ' + (u.username || u.id)));
  await p.$disconnect();
}

main();
