/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
/**
 * Full HTTP test of every backend route against a throw-away MySQL database
 * (see e2e-env.ts — never the real one). Run with `npm run test:api`.
 *
 * beforeAll resets `leave_management_e2e`, seeds it (prisma/seed.ts +
 * seed-admin.js) and boots the real AppModule with the same global pipes /
 * interceptors / filters as main.ts. E-mail sending and rate limiting are
 * stubbed. Each test hits one route through supertest; the last test fails if
 * any controller route was never called.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { ResponseInterceptor } from '../../src/utils/response.interceptor';
import { HttpExceptionFilter } from '../../src/utils/http-exception.filter';

type Role = 'employee' | 'employee2' | 'manager' | 'hr' | 'ceo' | 'admin';
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const ROOT = path.join(__dirname, '..', '..');
const SEED_PASSWORD = 'password1234';
const ACCOUNTS: Record<Role, [string, string]> = {
  employee: ['user@company.com', SEED_PASSWORD],
  employee2: ['dev2@company.com', SEED_PASSWORD],
  manager: ['manager@company.com', SEED_PASSWORD],
  hr: ['hrmanager@company.com', SEED_PASSWORD],
  ceo: ['ceo@company.com', SEED_PASSWORD],
  admin: ['admin@admin.com', 'admin1234'],
};

let app: NestExpressApplication;
let prisma: PrismaClient;
const tokens = {} as Record<Role, string>;
const refreshTokens = {} as Record<Role, string>;
const called = new Set<string>();
const ids: Record<string, string> = {};
let dates: string[] = [];

/** Calls `pattern` (with :params filled from `params`) and records it as covered. */
function call(
  method: Method,
  pattern: string,
  as?: Role | null,
  params: Record<string, string> = {},
) {
  called.add(`${method.toUpperCase()} ${pattern}`);
  const url = pattern.replace(/:(\w+)/g, (_, k: string) => {
    if (!params[k]) throw new Error(`missing :${k} for ${pattern}`);
    return encodeURIComponent(params[k]);
  });
  const req = request(app.getHttpServer())[method](`/api${url}`);
  return as ? req.set('Authorization', `Bearer ${tokens[as]}`) : req;
}

/** Fails with the response body in the message, so errors are readable. */
function expectStatus(res: request.Response, ...allowed: number[]) {
  if (!allowed.includes(res.status)) {
    throw new Error(
      `${res.req.method} ${res.req.path} → ${res.status} (expected ${allowed.join('/')})\n` +
        JSON.stringify(res.body).slice(0, 600),
    );
  }
}

async function captchaCode(captchaId: string) {
  const row = await prisma.captcha.findUnique({ where: { id: captchaId } });
  return row!.captchaCode;
}

async function login(role: Role) {
  const [username, password] = ACCOUNTS[role];
  const c = await call('get', '/auth/captcha');
  const captchaId: string = c.body.data.captcha_id;
  const res = await call('post', '/auth/login').send({
    username,
    password,
    captchaId,
    captchaInput: await captchaCode(captchaId),
  });
  expectStatus(res, 200);
  tokens[role] = res.body.data.accessToken;
  refreshTokens[role] = res.body.data.refreshToken;
}

const employeeOf = (email: string) =>
  prisma.employee.findFirstOrThrow({ where: { user: { email } } });

const leaveTypeId = async (name: string) =>
  (await prisma.leaveType.findFirstOrThrow({ where: { name } })).id;

async function statusOf(id: string) {
  return (await prisma.leaveRequest.findUniqueOrThrow({ where: { id } }))
    .status;
}

/** Submits a full-day leave as `role` and returns the new request id. */
async function submitLeave(
  role: Role,
  typeName: string,
  date: string,
  reason = 'ทดสอบระบบ (e2e)',
) {
  const res = await call('post', '/leave', role).send({
    leaveTypeId: await leaveTypeId(typeName),
    leaveMode: 'full_day',
    startDate: date,
    endDate: date,
    reason,
  });
  expectStatus(res, 201);
  const emp = await employeeOf(ACCOUNTS[role][0]);
  const row = await prisma.leaveRequest.findFirstOrThrow({
    where: { employeeId: emp.id },
    orderBy: { createdAt: 'desc' },
  });
  return row.id;
}

/** Working days (Mon–Fri, not a public holiday) starting ~5 weeks from now. */
async function futureWorkingDays(count: number) {
  const holidays = new Set(
    (await prisma.publicHoliday.findMany()).map((h) =>
      h.date.toISOString().slice(0, 10),
    ),
  );
  const out: string[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 35);
  while (out.length < count) {
    const iso = d.toISOString().slice(0, 10);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Every route declared in the controllers, e.g. "PUT /hr/leaves/:id/verify". */
function declaredRoutes() {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.controller.ts')) {
        const src = fs.readFileSync(p, 'utf8');
        const base = /@Controller\(\s*['"`]([^'"`]*)/.exec(src)?.[1] ?? '';
        const re = /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          const route = `/${base}/${m[2] ?? ''}`
            .replace(/\/+/g, '/')
            .replace(/(.)\/$/, '$1');
          routes.push(`${m[1].toUpperCase()} ${route}`);
        }
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return routes;
}

// Tiny valid-looking files (only the magic bytes are checked).
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  const env = { ...process.env };
  const run = (cmd: string) => execSync(cmd, { cwd: ROOT, env, stdio: 'pipe' });
  run('npx prisma db push --force-reset --skip-generate --accept-data-loss');
  run('npx ts-node prisma/seed.ts');
  run('node prisma/seed-admin.js');

  prisma = new PrismaClient();
  jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
  jest
    .spyOn(NotificationService.prototype, 'sendEmail')
    .mockResolvedValue(true);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: ['error'],
  });
  app.setGlobalPrefix('api');
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  dates = await futureWorkingDays(10);
}, 300_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

// ───────────────────────────── public / auth ─────────────────────────────
describe('public & auth', () => {
  it('GET / and /health', async () => {
    expectStatus(await call('get', '/'), 200);
    expectStatus(await call('get', '/health'), 200);
  });

  it('GET /auth/config', async () => {
    expectStatus(await call('get', '/auth/config'), 200);
  });

  it('POST /auth/captcha/verify — correct code 200, reused 400', async () => {
    const c = await call('get', '/auth/captcha');
    expectStatus(c, 200);
    const captchaId: string = c.body.data.captcha_id;
    const body = { captchaId, captchaCode: await captchaCode(captchaId) };
    expectStatus(await call('post', '/auth/captcha/verify').send(body), 200);
    expectStatus(await call('post', '/auth/captcha/verify').send(body), 400);
  });

  it('POST /auth/login — every role; wrong password is 401', async () => {
    for (const role of Object.keys(ACCOUNTS) as Role[]) await login(role);
    const c = await call('get', '/auth/captcha');
    const captchaId: string = c.body.data.captcha_id;
    const bad = await call('post', '/auth/login').send({
      username: 'sales1@company.com',
      password: 'wrong-password',
      captchaId,
      captchaInput: await captchaCode(captchaId),
    });
    expectStatus(bad, 401, 400);
  });

  it('rejects missing token (401) and wrong role (403)', async () => {
    expectStatus(await call('get', '/leave/me'), 401);
    expectStatus(await call('get', '/hr/dashboard', 'employee'), 403);
    expectStatus(await call('get', '/admin/overview', 'hr'), 403);
    expectStatus(await call('post', '/leave', 'admin').send({}), 403);
  });

  it('GET /auth/password-status', async () => {
    expectStatus(await call('get', '/auth/password-status', 'employee'), 200);
  });

  it('PUT /auth/profile (phone)', async () => {
    const res = await call('put', '/auth/profile', 'employee').send({
      phone: '0812345678',
    });
    expectStatus(res, 200);
  });

  it('POST /auth/refresh', async () => {
    const res = request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${refreshTokens.employee2}`);
    called.add('POST /auth/refresh');
    const r = await res;
    expectStatus(r, 200);
    tokens.employee2 = r.body.data.accessToken;
  });

  it('POST /auth/forgot-password', async () => {
    const res = await call('post', '/auth/forgot-password').send({
      username: 'sales1@company.com',
    });
    expectStatus(res, 200);
  });

  it('POST /auth/reset-password — invalid token is rejected', async () => {
    const res = await call('post', '/auth/reset-password').send({
      token: 'not-a-real-token',
      newPassword: 'newpass123',
    });
    expectStatus(res, 400, 401);
  });
});

// ───────────────────────────── employee (/leave) ─────────────────────────────
describe('employee /leave', () => {
  it.each([
    ['/leave/dashboard'],
    ['/leave/types'],
    ['/leave/holidays'],
    ['/leave/history'],
    ['/leave/all-leaves'],
    ['/leave/department'],
    ['/leave/me'],
    ['/leave/balance'],
  ])('GET %s', async (p) => {
    expectStatus(await call('get', p, 'employee'), 200);
  });

  it('GET /leave/day-availability', async () => {
    const res = await call('get', '/leave/day-availability', 'employee').query({
      startDate: dates[0],
      endDate: dates[1],
    });
    expectStatus(res, 200);
  });

  it('PATCH /leave/me/avatar', async () => {
    const res = await call('patch', '/leave/me/avatar', 'employee').send({
      avatarUrl: `data:image/png;base64,${PNG.toString('base64')}`,
    });
    expectStatus(res, 200);
  });

  it('POST /leave → PUT /leave/:id → DELETE /leave/:id', async () => {
    const id = await submitLeave('employee', 'ลาป่วย', dates[0]);
    ids.editable = id;

    const upd = await call('put', '/leave/:id', 'employee', { id }).send({
      reason: 'แก้ไขเหตุผล (e2e)',
    });
    expectStatus(upd, 200);
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(row.reason).toBe('แก้ไขเหตุผล (e2e)');
  });

  it('POST /upload — attach a PDF to own leave; others are 403', async () => {
    const res = await call('post', '/upload', 'employee')
      .field('leaveRequestId', ids.editable)
      .attach('file', PDF, 'cert.pdf');
    expectStatus(res, 201);
    const other = await call('post', '/upload', 'employee2')
      .field('leaveRequestId', ids.editable)
      .attach('file', PDF, 'cert.pdf');
    expectStatus(other, 403);
  });

  it('DELETE /leave/:id — a still-pending request can be cancelled (200)', async () => {
    const res = await call('delete', '/leave/:id', 'employee', {
      id: ids.editable,
    });
    expectStatus(res, 200);
    expect(await statusOf(ids.editable)).toBe('CANCELLED');
  });

  it('POST /upload/avatar', async () => {
    const res = await call('post', '/upload/avatar', 'employee').attach(
      'file',
      PNG,
      'me.png',
    );
    expectStatus(res, 201, 200);
  });

  it('CEO cannot file leave (403)', async () => {
    const res = await call('post', '/leave', 'ceo').send({
      leaveTypeId: await leaveTypeId('ลาป่วย'),
      leaveMode: 'full_day',
      startDate: dates[9],
      endDate: dates[9],
      reason: 'x',
    });
    expectStatus(res, 403);
  });
});

// ───────────────────────────── approval workflow ─────────────────────────────
describe('leave approval workflow (HR → Manager → CEO)', () => {
  const hrVerify = (id: string, action: 'Approve' | 'Reject') =>
    call('put', '/hr/leaves/:id/verify', 'hr', { id }).send({
      action,
      comment: `${action} (e2e)`,
    });

  it('normal leave: HR approve → Manager approve → APPROVED', async () => {
    const id = await submitLeave('employee', 'ลาป่วย', dates[1]);
    ids.approved = id;
    expect(await statusOf(id)).toBe('PENDING_VERIFY');

    const pending = await call('get', '/hr/leaves/pending-verify', 'hr');
    expectStatus(pending, 200);
    expect(JSON.stringify(pending.body)).toContain(id);

    expectStatus(
      await call('patch', '/hr/leaves/:id/view', 'hr', { id }).query({
        lock: 'true',
      }),
      200,
    );
    expectStatus(await hrVerify(id, 'Approve'), 200);
    expect(await statusOf(id)).toBe('PENDING_SUPERVISOR');

    const mp = await call('get', '/manager/pending', 'manager');
    expectStatus(mp, 200);
    expect(JSON.stringify(mp.body)).toContain(id);

    const ok = await call('put', '/manager/approve/:id', 'manager', {
      id,
    }).send({ comment: 'อนุมัติ (e2e)' });
    expectStatus(ok, 200);
    expect(await statusOf(id)).toBe('APPROVED');
  });

  it('cancel approved future leave: DELETE → PENDING_CANCELLATION → HR approve → CANCELLED', async () => {
    const id = ids.approved;
    const del = await call('delete', '/leave/:id', 'employee', { id });
    expectStatus(del, 200);
    expect(await statusOf(id)).toBe('PENDING_CANCELLATION');
    expectStatus(await hrVerify(id, 'Approve'), 200);
    expect(await statusOf(id)).toBe('CANCELLED');
  });

  it('HR reject → REJECTED', async () => {
    const id = await submitLeave('employee', 'ลาป่วย', dates[2]);
    expectStatus(await hrVerify(id, 'Reject'), 200);
    expect(await statusOf(id)).toBe('REJECTED');
  });

  it('Manager reject → REJECTED', async () => {
    const id = await submitLeave('employee', 'ลาป่วย', dates[3]);
    expectStatus(await hrVerify(id, 'Approve'), 200);
    const res = await call('put', '/manager/reject/:id', 'manager', {
      id,
    }).send({ comment: 'ไม่อนุมัติ (e2e)' });
    expectStatus(res, 200);
    expect(await statusOf(id)).toBe('REJECTED');
  });

  it('special leave: HR → Manager → CEO approve → APPROVED', async () => {
    const id = await submitLeave(
      'employee',
      'ลาพักผ่อนประจำปี (พักร้อน)',
      dates[4],
    );
    expectStatus(await hrVerify(id, 'Approve'), 200);
    expectStatus(
      await call('put', '/manager/approve/:id', 'manager', { id }).send({}),
      200,
    );
    expect(await statusOf(id)).toBe('PENDING_EXECUTIVE');

    const cp = await call('get', '/ceo/pending', 'ceo');
    expectStatus(cp, 200);
    expect(JSON.stringify(cp.body)).toContain(id);

    const ok = await call('put', '/ceo/approve/:id', 'ceo', { id }).send({
      comment: 'อนุมัติ (e2e)',
    });
    expectStatus(ok, 200);
    expect(await statusOf(id)).toBe('APPROVED');
  });

  it('special leave: CEO reject → REJECTED', async () => {
    const id = await submitLeave(
      'employee',
      'ลาพักผ่อนประจำปี (พักร้อน)',
      dates[5],
    );
    expectStatus(await hrVerify(id, 'Approve'), 200);
    expectStatus(
      await call('put', '/manager/approve/:id', 'manager', { id }).send({}),
      200,
    );
    const res = await call('put', '/ceo/reject/:id', 'ceo', { id }).send({
      comment: 'ไม่อนุมัติ (e2e)',
    });
    expectStatus(res, 200);
    expect(await statusOf(id)).toBe('REJECTED');
  });

  it('a manager from another department cannot approve (403/400)', async () => {
    const id = await submitLeave('employee', 'ลาป่วย', dates[6]);
    expectStatus(await hrVerify(id, 'Approve'), 200);
    // The HR user is a manager-capable role but in the HR department.
    const res = await call('put', '/manager/approve/:id', 'hr', { id }).send(
      {},
    );
    expectStatus(res, 403, 400);
    expect(await statusOf(id)).toBe('PENDING_SUPERVISOR');
  });

  it.each([['/manager/dashboard'], ['/manager/history']])(
    'GET %s',
    async (p) => {
      expectStatus(await call('get', p, 'manager'), 200);
    },
  );
});

// ───────────────────────────── notifications / announcements ─────────────────
describe('notifications & announcements', () => {
  it('GET /notifications, PATCH :id/read, POST read-all, PATCH readAll', async () => {
    const list = await call('get', '/notifications', 'employee');
    expectStatus(list, 200);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ACCOUNTS.employee[0] },
    });
    const n = await prisma.notification.findFirst({
      where: { userId: user.id },
    });
    expect(n).toBeTruthy();
    expectStatus(
      await call('patch', '/notifications/:id/read', 'employee', {
        id: n!.id,
      }),
      200,
    );
    expectStatus(
      await call('post', '/notifications/read-all', 'employee'),
      201,
      200,
    );
    expectStatus(
      await call('patch', '/notifications/readAll', 'employee'),
      200,
    );
    expect(
      await prisma.notification.count({
        where: { userId: user.id, isRead: false },
      }),
    ).toBe(0);
  });

  it('announcement: POST → GET → PATCH → DELETE (HR); employee cannot create', async () => {
    const created = await call('post', '/announcement', 'hr').send({
      title: 'ประกาศทดสอบ (e2e)',
      subtitle: 'รายละเอียด',
      isImportant: true,
    });
    expectStatus(created, 201);
    const id: string = created.body.data.id;

    const list = await call('get', '/announcement', 'employee').query({
      limit: '5',
    });
    expectStatus(list, 200);
    expect(JSON.stringify(list.body)).toContain(id);

    expectStatus(
      await call('patch', '/announcement/:id', 'hr', { id }).send({
        title: 'แก้ไขแล้ว (e2e)',
      }),
      200,
    );
    expectStatus(await call('delete', '/announcement/:id', 'hr', { id }), 200);
    expect(await prisma.announcement.count({ where: { id } })).toBe(0);

    expectStatus(
      await call('post', '/announcement', 'employee').send({
        title: 'x',
        subtitle: 'x',
        isImportant: false,
      }),
      403,
    );
  });
});

// ───────────────────────────── HR ─────────────────────────────
describe('HR', () => {
  it.each([
    ['/hr/dashboard'],
    ['/hr/leave-summary'],
    ['/hr/departments'],
    ['/hr/roles'],
    ['/hr/positions'],
    ['/hr/leave-types'],
    ['/hr/employees'],
    ['/hr/leaves'],
    ['/hr/holidays'],
  ])('GET %s', async (p) => {
    expectStatus(await call('get', p, 'hr'), 200);
  });

  it('departments: POST → PUT → DELETE', async () => {
    const c = await call('post', '/hr/departments', 'hr').send({
      name: 'แผนกทดสอบ e2e',
      code: 'E2E',
    });
    expectStatus(c, 201);
    const dept = await prisma.department.findFirstOrThrow({
      where: { name: 'แผนกทดสอบ e2e' },
    });
    ids.dept = dept.id;
    expectStatus(
      await call('put', '/hr/departments/:id', 'hr', { id: dept.id }).send({
        name: 'แผนกทดสอบ e2e (แก้ไข)',
      }),
      200,
    );
  });

  it('positions: POST → PUT → DELETE', async () => {
    const c = await call('post', '/hr/positions', 'hr').send({
      name: 'ตำแหน่งทดสอบ e2e',
      departmentId: ids.dept,
    });
    expectStatus(c, 201);
    const pos = await prisma.position.findFirstOrThrow({
      where: { name: 'ตำแหน่งทดสอบ e2e' },
    });
    expectStatus(
      await call('put', '/hr/positions/:id', 'hr', { id: pos.id }).send({
        name: 'ตำแหน่งทดสอบ e2e (แก้ไข)',
      }),
      200,
    );
    expectStatus(
      await call('delete', '/hr/positions/:id', 'hr', { id: pos.id }),
      200,
    );
    expectStatus(
      await call('delete', '/hr/departments/:id', 'hr', { id: ids.dept }),
      200,
    );
  });

  it('leave types: POST → PATCH → DELETE', async () => {
    const c = await call('post', '/hr/leave-types', 'hr').send({
      name: 'ประเภทลาทดสอบ e2e',
      defaultDays: 2,
    });
    expectStatus(c, 201);
    const lt = await prisma.leaveType.findFirstOrThrow({
      where: { name: 'ประเภทลาทดสอบ e2e' },
    });
    expectStatus(
      await call('patch', '/hr/leave-types/:id', 'hr', { id: lt.id }).send({
        defaultDays: 3,
      }),
      200,
    );
    expectStatus(
      await call('delete', '/hr/leave-types/:id', 'hr', { id: lt.id }),
      200,
    );
  });

  it('holidays: POST → PUT → DELETE', async () => {
    const c = await call('post', '/hr/holidays', 'hr').send({
      name: 'วันหยุดทดสอบ e2e',
      date: dates[8],
    });
    expectStatus(c, 201);
    const h = await prisma.publicHoliday.findFirstOrThrow({
      where: { name: 'วันหยุดทดสอบ e2e' },
    });
    expectStatus(
      await call('put', '/hr/holidays/:id', 'hr', { id: h.id }).send({
        name: 'วันหยุดทดสอบ e2e (แก้ไข)',
      }),
      200,
    );
    expectStatus(
      await call('delete', '/hr/holidays/:id', 'hr', { id: h.id }),
      200,
    );
  });

  it('employees: POST → GET :id → PATCH → status → balances', async () => {
    const dept = await prisma.department.findFirstOrThrow({
      where: { name: 'Software Development Department' },
    });
    const pos = await prisma.position.findFirstOrThrow({
      where: { name: 'Programmer', departmentId: dept.id },
    });
    const c = await call('post', '/hr/employees', 'hr').send({
      email: 'e2e.temp@company.com',
      firstName: 'ทดสอบ',
      lastName: 'อีทูอี',
      departmentId: dept.id,
      positionId: pos.id,
      roleName: 'Employee',
      password: 'temp123456',
      hireDate: '2024-01-15',
      gender: 'Male',
    });
    expectStatus(c, 201);
    const emp = await employeeOf('e2e.temp@company.com');
    ids.tempEmployee = emp.id;
    ids.tempUser = emp.userId;

    expectStatus(
      await call('get', '/hr/employees/:id', 'hr', { id: emp.id }),
      200,
    );
    expectStatus(
      await call('patch', '/hr/employees/:id', 'hr', { id: emp.id }).send({
        phone: '0899999999',
      }),
      200,
    );
    expectStatus(
      await call('patch', '/hr/employees/:id/status', 'hr', {
        id: emp.id,
      }).send({ isActive: false }),
      200,
    );
    expectStatus(
      await call('patch', '/hr/employees/:id/status', 'hr', {
        id: emp.id,
      }).send({ isActive: true }),
      200,
    );
    expectStatus(
      await call('post', '/hr/employees/:id/initialize-leave-balances', 'hr', {
        id: emp.id,
      }),
      201,
      200,
    );
    expectStatus(
      await call('post', '/hr/employees/:id/reset-leave-balances', 'hr', {
        id: emp.id,
      }),
      201,
      200,
    );

    const bal = await prisma.leaveBalance.findFirstOrThrow({
      where: { employeeId: emp.id },
    });
    expectStatus(
      await call('put', '/hr/leave-balances/:id', 'hr', { id: bal.id }).send({
        totalDays: 10,
        remainingDays: 10,
      }),
      200,
    );
  });

  it.each([['/export/excel'], ['/export/pdf']])(
    'GET %s (HR and CEO)',
    async (p) => {
      expectStatus(await call('get', p, 'hr'), 200);
      expectStatus(await call('get', p, 'ceo'), 200);
      expectStatus(await call('get', p, 'employee'), 403);
    },
  );
});

// ───────────────────────────── CEO ─────────────────────────────
describe('CEO', () => {
  it.each([
    ['/ceo/dashboard'],
    ['/ceo/report/company'],
    ['/ceo/report/stats'],
    ['/ceo/employees'],
    ['/hr/departments'],
    ['/hr/employees'],
    ['/hr/leaves'],
  ])('GET %s', async (p) => {
    expectStatus(await call('get', p, 'ceo'), 200);
  });

  it('GET /ceo/report/department', async () => {
    const dept = await prisma.department.findFirstOrThrow();
    const res = await call('get', '/ceo/report/department', 'ceo').query({
      id: dept.id,
    });
    expectStatus(res, 200);
  });
});

// ───────────────────────────── Admin ─────────────────────────────
describe('Admin', () => {
  it.each([
    ['/admin/overview'],
    ['/admin/users'],
    ['/admin/users/all'],
    ['/admin/audit-logs'],
    ['/admin/settings'],
    ['/admin/system-health'],
    ['/admin/audit-logs/export'],
    ['/admin/captcha/stats'],
    ['/admin/roles'],
  ])('GET %s', async (p) => {
    expectStatus(await call('get', p, 'admin'), 200);
  });

  it('PATCH /admin/settings', async () => {
    const current = await call('get', '/admin/settings', 'admin');
    const data = current.body.data;
    const list: { key: string; value: string }[] = (
      Array.isArray(data)
        ? data
        : Object.entries(data ?? {}).map(([key, value]) => ({ key, value }))
    )
      .filter((s: { key?: unknown }) => typeof s.key === 'string')
      .slice(0, 1)
      .map((s: { key: string; value: unknown }) => ({
        key: s.key,
        value: String(s.value),
      }));
    const res = await call('patch', '/admin/settings', 'admin').send({
      settings: list,
    });
    expectStatus(res, 200);
  });

  it('user actions on a temp user: role, toggle-status, reset-password, force-logout', async () => {
    const id = ids.tempUser;
    const role = await prisma.role.findFirstOrThrow({
      where: { name: 'Manager' },
    });
    expectStatus(
      await call('patch', '/admin/users/:id/role', 'admin', { id }).send({
        roleId: role.id,
      }),
      200,
    );
    expectStatus(
      await call('patch', '/admin/users/:id/toggle-status', 'admin', {
        id,
      }).send({ isActive: false }),
      200,
    );
    expectStatus(
      await call('patch', '/admin/users/:id/toggle-status', 'admin', {
        id,
      }).send({ isActive: true }),
      200,
    );
    expectStatus(
      await call('post', '/admin/users/:id/reset-password', 'admin', { id }),
      201,
      200,
    );
    const before = (await prisma.user.findUniqueOrThrow({ where: { id } }))
      .tokenVersion;
    expectStatus(
      await call('patch', '/admin/users/:id/force-logout', 'admin', { id }),
      200,
    );
    const after = (await prisma.user.findUniqueOrThrow({ where: { id } }))
      .tokenVersion;
    expect(after).toBeGreaterThan(before);
  });

  it('DELETE /admin/captcha/purge', async () => {
    expectStatus(await call('delete', '/admin/captcha/purge', 'admin'), 200);
  });

  it('DELETE /hr/employees/:id (temp employee)', async () => {
    expectStatus(
      await call('delete', '/hr/employees/:id', 'hr', {
        id: ids.tempEmployee,
      }),
      200,
    );
  });
});

// ───────────────────────────── wrap-up ─────────────────────────────
describe('wrap-up', () => {
  it('POST /auth/logout invalidates the access token', async () => {
    expectStatus(await call('post', '/auth/logout', 'employee2'), 200);
    expectStatus(await call('get', '/leave/me', 'employee2'), 401);
  });

  it('every controller route was exercised', () => {
    const declared = declaredRoutes();
    expect(declared.length).toBeGreaterThan(90);
    const missing = declared.filter((r) => !called.has(r));
    expect(missing).toEqual([]);
  });
});
