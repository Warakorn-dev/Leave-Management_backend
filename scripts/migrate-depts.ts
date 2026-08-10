const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const newStructure = [
  {
    dept: 'Human Resource Department',
    positions: ['SSO', 'HR Office']
  },
  {
    dept: 'Account & Finance Department',
    positions: ['RD', 'Accounting & Finance']
  },
  {
    dept: 'Administration Department',
    positions: ['Office admin', 'Operator']
  },
  {
    dept: 'Sales & Marketing Department',
    positions: ['Graphic designer', 'Marketing Officer']
  },
  {
    dept: 'Service & Support Department',
    positions: ['Senior Technical  Support', 'Technical Support']
  },
  {
    dept: 'Software Development Department',
    positions: ['SA & Senior Programmer', 'Programmer']
  },
  {
    dept: 'Project Department',
    positions: ['Leader', 'Senior Asistance Project Manager', 'Asistance Project Manager']
  }
];

async function main() {
  console.log('Starting migration...');
  
  // 1. Create new departments and positions
  const createdDepts: any[] = [];
  const createdPositions: any[] = [];
  
  for (const item of newStructure) {
    let dept = await prisma.department.findUnique({ where: { name: item.dept } });
    if (!dept) {
      dept = await prisma.department.create({ data: { name: item.dept } });
    }
    createdDepts.push(dept);
    
    for (const posName of item.positions) {
      let pos = await prisma.position.findFirst({ where: { name: posName, departmentId: dept.id } });
      if (!pos) {
        pos = await prisma.position.create({ data: { name: posName, departmentId: dept.id } });
      }
      createdPositions.push(pos);
    }
  }
  
  console.log('Created new departments and positions.');
  
  // 2. Fetch all employees and assign to new structure
  const employees = await prisma.employee.findMany({ include: { department: true, position: true } });
  
  const getPosId = (deptName, posName) => {
    const d = createdDepts.find(d => d.name === deptName);
    const p = createdPositions.find(p => p.name === posName && p.departmentId === d?.id);
    if (!d || !p) throw new Error(`Mapping failed for ${deptName} ${posName}`);
    return { departmentId: d.id, positionId: p.id };
  };

  for (const emp of employees) {
    let newMapping;
    if (emp.firstName.includes('สายฝน') || emp.firstName.includes('สมศักดิ์')) {
      newMapping = getPosId('Software Development Department', 'Programmer');
    } else if (emp.firstName.includes('เอกพงศ์')) {
      newMapping = getPosId('Software Development Department', 'SA & Senior Programmer');
    } else if (emp.firstName.includes('วิไล')) {
      newMapping = getPosId('Human Resource Department', 'HR Office');
    } else if (emp.firstName.includes('มาลี')) {
      newMapping = getPosId('Sales & Marketing Department', 'Marketing Officer');
    } else if (emp.firstName.includes('สมชาย')) {
      newMapping = getPosId('Project Department', 'Leader');
    } else {
      newMapping = getPosId('Administration Department', 'Office admin'); // Default
    }
    
    await prisma.employee.update({
      where: { id: emp.id },
      data: newMapping
    });
    console.log(`Moved employee ${emp.firstName} ${emp.lastName} to ${newMapping.departmentId}`);
  }
  
  // 3. Delete old departments and positions
  const newDeptIds = createdDepts.map(d => d.id);
  const newPosIds = createdPositions.map(p => p.id);
  
  // Delete positions that are not in the new list
  const deletedPos = await prisma.position.deleteMany({
    where: {
      id: { notIn: newPosIds }
    }
  });
  console.log(`Deleted ${deletedPos.count} old positions.`);
  
  // Delete departments that are not in the new list
  const deletedDept = await prisma.department.deleteMany({
    where: {
      id: { notIn: newDeptIds }
    }
  });
  console.log(`Deleted ${deletedDept.count} old departments.`);
  
  console.log('Migration completed successfully.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
