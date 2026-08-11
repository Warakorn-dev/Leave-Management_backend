import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // User-specified order
  const specificOrder: Record<string, string> = {
    'ลาป่วย': '01',
    'ลากิจ': '02',
    // '03' reserved for ลากิจธุระอันจำเป็น (not in DB yet)
    'ลาพักผ่อนประจำปี': '04',
  };

  const allLeaveTypes = await prisma.leaveType.findMany();
  console.log('Total leave types:', allLeaveTypes.length);

  // Step 1: Set all codes to temp values to avoid unique constraint conflicts
  for (let i = 0; i < allLeaveTypes.length; i++) {
    await prisma.$executeRawUnsafe(
      `UPDATE leavetype SET code = ? WHERE id = ?`,
      `T${i}`,
      allLeaveTypes[i].id,
    );
  }
  console.log('Step 1: Temporary codes set');

  // Step 2: Set specific codes
  for (const [name, code] of Object.entries(specificOrder)) {
    const lt = allLeaveTypes.find(t => t.name === name);
    if (lt) {
      await prisma.$executeRawUnsafe(
        `UPDATE leavetype SET code = ? WHERE id = ?`,
        code,
        lt.id,
      );
      console.log(`Set: ${code} → ${name}`);
    } else {
      console.log(`NOT FOUND: ${name} (code ${code} reserved)`);
    }
  }

  // Step 3: Number remaining leave types starting from 05
  const assignedNames = new Set(Object.keys(specificOrder));
  const remaining = allLeaveTypes
    .filter(lt => !assignedNames.has(lt.name))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let nextCode = 5;
  for (const lt of remaining) {
    const code = String(nextCode).padStart(2, '0');
    await prisma.$executeRawUnsafe(
      `UPDATE leavetype SET code = ? WHERE id = ?`,
      code,
      lt.id,
    );
    console.log(`Set: ${code} → ${lt.name}`);
    nextCode++;
  }

  // Verify
  const result = await prisma.leaveType.findMany({ orderBy: { code: 'asc' } });
  console.log('\n=== Final Result ===');
  result.forEach(lt => console.log(`code: ${lt.code} | ${lt.name}`));
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); });
