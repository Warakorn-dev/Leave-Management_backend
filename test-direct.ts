import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { HrService } from './src/modules/hr/hr.service';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const hrService = app.get(HrService);
  const prisma = app.get(PrismaService);

  const emp = await prisma.employee.findFirst({
    include: { user: { include: { role: true } } }
  });

  if (!emp) {
    console.log('No employee found');
    await app.close();
    return;
  }

  console.log('Testing with employee:', emp.id);

  try {
    const dto = {
      employeeCode: emp.employeeCode || undefined,
      username: emp.user.username || undefined,
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.user.email,
      phone: emp.phone || undefined,
      departmentId: emp.departmentId,
      positionId: emp.positionId,
      roleName: emp.user.role?.name,
      hireDate: emp.hireDate.toISOString().split('T')[0],
      gender: emp.gender || 'Unspecified'
    };

    console.log('DTO:', dto);
    
    // Add missing fields just to be safe (the frontend might send them later)
    const result = await hrService.updateEmployee({ role: 'CEO' }, emp.id, dto);
    console.log('SUCCESS:', result.id);
  } catch (err) {
    console.error('ERROR OCCURRED:');
    console.error(err);
  }

  await app.close();
}

bootstrap();
