import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updatePositions() {
  const departments = await prisma.department.findMany();
  
  const deptMap: Record<string, string> = {};
  for (const d of departments) {
    deptMap[d.name] = d.id;
  }

  const mapping: Record<string, string> = {
    'Leader': deptMap['Executive'] || '',
    'SSO': deptMap['Software Development Department'] || '',
    'HR Office': deptMap['Human Resource Department'] || '',
    'RD': deptMap['Software Development Department'] || '',
    'Accounting & Finance': deptMap['Account & Finance Department'] || '',
    'Office admin': deptMap['Administration Department'] || '',
    'Operator': deptMap['Administration Department'] || '',
    'Graphic designer': deptMap['Administration Department'] || '',
    'Marketing Officer': deptMap['Sales & Marketing Department'] || '',
    'Senior Technical Support': deptMap['Service & Support Department'] || '',
    'Technical Support': deptMap['Service & Support Department'] || '',
    'SA & Senior Programmer': deptMap['Software Development Department'] || '',
    'Programmer': deptMap['Software Development Department'] || '',
    'Senior Asistance Project Manager': deptMap['Project Department'] || '',
    'Asistance Project Manager': deptMap['Project Department'] || '',
    'CEO': deptMap['Executive'] || '',
  };

  const positions = await prisma.position.findMany();
  for (const pos of positions) {
    const deptId = mapping[pos.name];
    if (deptId && !pos.departmentId) {
      await prisma.position.update({
        where: { id: pos.id },
        data: { departmentId: deptId }
      });
      console.log(`Updated position ${pos.name} with department ${deptId}`);
    }
  }

  console.log('Done mapping positions to departments!');
}

updatePositions().catch(console.error).finally(() => prisma.$disconnect());
