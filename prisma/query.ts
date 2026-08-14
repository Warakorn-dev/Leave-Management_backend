import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const all = await prisma.leaveType.findMany({ orderBy: { code: 'asc' } });

  // Re-number sequentially: 01, 02, 03, ...
  // Step 1: Set temp codes to avoid unique conflicts
  for (let i = 0; i < all.length; i++) {
    await prisma.$executeRawUnsafe(
      `UPDATE leavetype SET code = ? WHERE id = ?`,
      `T${i}`,
      all[i].id,
    );
  }

  // Step 2: Assign sequential codes (keeping current order)
  for (let i = 0; i < all.length; i++) {
    const code = String(i + 1).padStart(2, '0');
    await prisma.$executeRawUnsafe(
      `UPDATE leavetype SET code = ? WHERE id = ?`,
      code,
      all[i].id,
    );
  }

  // Verify
  const result = await prisma.leaveType.findMany({ orderBy: { code: 'asc' } });
  console.log('\n=== Final Result ===');
  result.forEach(lt => console.log(`code: ${lt.code} | ${lt.name}`));
}

main().then(() => prisma.$disconnect());
