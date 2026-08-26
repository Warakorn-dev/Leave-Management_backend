const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

async function test() {
  const users = await prisma.user.findMany();
  let hasError = false;

  for (const user of users) {
    const token = jwt.sign({ sub: user.id, username: user.username }, 'super-secret-key-for-jwt', { expiresIn: '1h' });
    try {
      const res = await fetch('http://127.0.0.1:8000/api/notifications', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const text = await res.text();
      if (res.status !== 200) {
        console.log(`Error for user ${user.username} (${user.id}):`, res.status, text);
        hasError = true;
      }
    } catch (e) {
      console.log(`Fetch error for user ${user.username}:`, e.message);
      hasError = true;
    }
  }
  
  if (!hasError) console.log('All users fetched notifications successfully (200 OK)!');
}

test().catch(console.error).finally(() => prisma.$disconnect());

