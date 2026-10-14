# Backend — Leave-Management API (NestJS)

ภาพรวมทั้งระบบและ workflow ใบลาอยู่ที่ [`../CLAUDE.md`](../CLAUDE.md) — ไฟล์นี้เน้นรายละเอียดฝั่ง backend

## Stack
NestJS 11 · Prisma 5 (MySQL 8) · passport-jwt (access + refresh) · bcrypt · `@nestjs/throttler` · `@nestjs/schedule` (cron) · Nodemailer · exceljs/pdfkit (export) · svg-captcha · Swagger

## คำสั่ง
```bash
docker-compose up -d             # MySQL dev (root/rootpassword, DB leave_management)
cp .env.example .env             # ค่าตัวอย่างสำหรับ dev
npx prisma migrate dev           # สร้าง/อัปเดต schema
npx prisma db seed               # prisma/seed.ts (seed-admin.js = สร้างบัญชี Admin)
npm run start:dev                # http://localhost:8000/api , Swagger /api-docs (dev เท่านั้น)
npm test                         # unit: src/**/*.spec.ts
npm run test:cov                 # coverage -> coverage/
npm run test:api                 # test/api/*.api-spec.ts (runInBand)
npm run test:smoke               # scripts/api-smoke-test.js (ยิง API จริง)
npm run lint / npm run format
npm run build && npm run start:prod   # production ใช้ PM2: ecosystem.config.js
```
Production: `npm run db:init` (scripts/init-production-db.js), `npm run db:seed:prod` (prisma/seed-production.js)

## Environment (.env) — ชื่อตัวแปรเท่านั้น
`NODE_ENV`, `PORT` (default 8000), `DATABASE_URL`, `CORS_ORIGINS` (หรือ `FRONTEND_URL`), `FRONTEND_URL` (ใช้สร้างลิงก์ใน email), `TRUST_PROXY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRATION` (15m), `JWT_REFRESH_EXPIRATION` (7d), `SMTP_HOST/PORT/USER/PASS`, `DISABLE_RATE_LIMIT` (ใช้เฉพาะ e2e, ไม่มีผลใน production)
- แอปจะไม่ start ถ้าไม่มี JWT secret หรือ (production) ไม่มี `CORS_ORIGINS`
- อ่าน config ผ่าน `ConfigService` ตาม key ใน `src/config/configuration.ts` (เช่น `jwt.secret`, `email.host`)

## โครงสร้าง `src/`
```
main.ts                      bootstrap: helmet, origin guard, CORS, static /uploads, prefix /api,
                             body limit 50mb, ValidationPipe(whitelist+forbidNonWhitelisted), Swagger
app.module.ts                Throttler (100 req/นาที global), Schedule, AuditLogInterceptor (global)
config/configuration.ts      map env -> config keys
prisma/                      PrismaModule / PrismaService
common/role-change.ts        roleChangeSignOut(): ใช้ทุกครั้งที่เปลี่ยน role (เตะออกทุกอุปกรณ์)
common/interceptors/audit-log.interceptor.ts   บันทึก POST/PUT/PATCH/DELETE ลง AuditLog
utils/response.interceptor.ts                  ห่อทุก response เป็น { success, message, data }
utils/http-exception.filter.ts                 แปลง error เป็นข้อความไทย, ซ่อนรายละเอียด Prisma/DB
utils/origin-guard.ts                          ตรวจ Origin (same-origin ผ่าน proxy หรืออยู่ใน CORS_ORIGINS)
modules/
  auth/        login (captcha + lockout), refresh, logout, profile, forgot/reset password, /auth/config
  employee/    controller '/leave' — ยื่น/แก้/ยกเลิกใบลา, balance, history, me
               services/employee-mutation.service.ts (write path + กฎ accrual/overlap)
               services/employee-query.service.ts (read path)
               leave-portion.util.ts (planDayPortions: แผนลาครึ่งวัน/เต็มวันรายวัน)
  hr/          controller '/hr' — master data, พนักงาน, holidays, ตรวจใบลาขั้นแรก
               services/hr-leave-verification.service.ts (คิว PENDING_VERIFY, lock, อนุมัติ/ปฏิเสธ, ยกเลิก)
               services/hr-employee.service.ts, hr-org.service.ts, hr-dashboard.service.ts
               services/hr-assignable-role.ts (roleForPosition, ห้าม HR แตะ Admin)
  manager/     controller '/manager' — หัวหน้าแผนกอนุมัติ PENDING_SUPERVISOR
  ceo/         controller '/ceo' — dashboard, report, อนุมัติ PENDING_EXECUTIVE
  admin/       controller '/admin' — users, force-logout, settings, audit logs, captcha, system health
  notification/ in-app notification + email + cron 09:00 (Asia/Bangkok) เตือนผู้อนุมัติ
               leave-history-url.ts: isLeaderPosition(), isDepartmentApprover(), URL ตาม role
  upload/      แนบไฟล์ใบลา / avatar
  export/      Excel / PDF (CEO, HR)
  announcement/ ประกาศ (อ่านได้ทุกคน, HR สร้าง/แก้/ลบ)
test-utils/leave-flow.fixtures.ts   fixture สำหรับ spec ของ workflow
```

## API Endpoints (ทั้งหมดอยู่ใต้ `/api`)
Guard: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)` ระดับ class, override ระดับ method ได้

| Prefix | Roles | Endpoints หลัก |
|---|---|---|
| `/auth` | public / JWT | `GET config`, `GET captcha`, `POST captcha/verify`, `POST login` (20/นาที), `POST logout`, `POST refresh` (ใช้ refresh token เป็น Bearer), `POST forgot-password` (5/นาที), `POST reset-password`, `PUT profile`, `GET password-status` |
| `/leave` | Employee, Manager, HR, CEO | `POST /` ยื่นลา, `PUT /:id`, `DELETE /:id` (ยกเลิก), `GET dashboard`, `types`, `holidays`, `day-availability`, `history`, `all-leaves`, `department`, `me`, `balance`, `PATCH me/avatar` |
| `/hr` | HR (บางอันเปิด CEO อ่าน) | CRUD `departments`, `positions`, `leave-types`, `holidays`, `employees` (+ `/:id/status`, `/:id/initialize-leave-balances`, `/:id/reset-leave-balances`), `GET roles`, `GET leaves`, `GET leaves/pending-verify`, `PUT leaves/:id/verify` (`{action:'Approve'|'Reject', comment}`), `PATCH leaves/:id/view` (lock), `PUT leave-balances/:id`, `GET dashboard`, `GET leave-summary` |
| `/manager` | Manager, HR | `GET dashboard`, `pending`, `history`, `PUT approve/:id`, `PUT reject/:id` |
| `/ceo` | CEO | `GET dashboard`, `report/company`, `report/stats`, `report/department?id=`, `pending`, `employees`, `PUT approve/:id`, `PUT reject/:id` |
| `/admin` | Admin | `overview`, `users`, `users/all`, `PATCH users/:id/force-logout`, `toggle-status`, `role`, `POST users/:id/reset-password`, `audit-logs` (+`/export`), `settings` (GET/PATCH), `system-health`, `captcha/stats`, `DELETE captcha/purge`, `roles` |
| `/notifications` | JWT | `GET /`, `PATCH :id/read`, `POST read-all` / `PATCH readAll` |
| `/upload` | JWT | `POST /` (แนบไฟล์ใบลา), `POST avatar` |
| `/export` | CEO, HR | `GET excel`, `GET pdf` |
| `/announcement` | JWT (เขียน = HR) | `GET /?limit=`, `POST`, `PATCH :id`, `DELETE :id` |

## Data model (`prisma/schema.prisma`)
- `User` (email, username, passwordHash, refreshToken, `tokenVersion`, `isActive`, lockout fields, `passwordChangedAt`) → `Role`
- `Employee` 1:1 `User` → `Department`, `Position` (`Position.roleId` = role ที่ตำแหน่งนั้นแนะนำ)
- `LeaveType` (`code` CHAR(2), `defaultDays`, `requiresCertificate`, **`isSpecial`** → ต้องผ่าน CEO, `advanceNoticeDays`, `minTenureDays`)
- `LeaveBalance` unique (employeeId, leaveTypeId, year): `totalDays`, `usedDays`, `remainingDays` (**remainingDays คือค่าจริง** — HR แก้มือได้ อย่าคำนวณใหม่จาก total-used)
- `LeaveRequest`: `requestCode` = `L-{typeCode}-{seq 5 หลัก}-{ปี พ.ศ.}`, `startFormat/endFormat` (`full|morning|afternoon`), `totalDays`, `paidDays`, `unpaidDays`, `status`, HR lock (`currentHrReviewerId`, `hrReviewStartedAt`, `isViewedByHr`)
- `LeaveRequestDay`: แยกรายวัน (`portion` = full/morning/afternoon) ไม่รวมวันหยุด/เสาร์อาทิตย์
- `LeaveApproval` (log ทุกการเปลี่ยนสถานะ), `LeaveAttachment` (`filePath` = **base64 data URL** เก็บใน LongText)
- อื่น ๆ: `PublicHoliday`, `Notification` (`redirectUrl`, `type`), `Announcement`, `AuditLog`, `Captcha`, `AdminSetting` (key/value), `HrSetting`
- ชื่อตารางจริงเป็น lowercase ผ่าน `@@map` (เช่น `leaverequest`)

## Business rules สำคัญ
**การยื่นลา** (`employee-mutation.service.ts`)
- CEO ยื่นลาไม่ได้ (403)
- ทุกใบเริ่มที่ `PENDING_VERIFY`; โควตาตรวจตอนยื่นแต่ **ยังไม่ตัด**
- ลาครึ่งวันซ้อนกันได้ (เช้า + บ่าย); ถ้าลาเต็มวันชนวันที่ถูกจองครึ่งวัน → วันนั้นลดเป็นครึ่งวัน; ถูกปฏิเสธเฉพาะเมื่อไม่มีช่องว่างเลย (`planDayPortions`)
- กันการยื่นซ้อนพร้อมกันด้วย row lock ใน transaction แล้ว plan ซ้ำ
- โหมด: `leaveMode` = `full_day | half_day | hourly` (รองรับ payload แบบเก่า startFormat/endFormat ด้วย)
- ลารายชั่วโมงเก็บ `startFormat/endFormat = 'hourly'` และคิดตาม `leaveHours`
- กฎ paid/unpaid ผูกกับ **ชื่อประเภทลาภาษาไทย** (`computeAccrual`, ใช้ร่วมกันทั้ง create และ update):
  - `ลาป่วย`: จ่าย ≤ 30 วัน/ปี ที่เหลือไม่จ่าย
  - `คลอดบุตร`: หญิง ≤ 135 วัน (จ่าย 60 + ครึ่งหนึ่งของส่วนเกิน 120), ชาย ≤ 15 วัน, ไม่ระบุเพศ → ยื่นไม่ได้
  - `ทหาร`: จ่าย ≤ 60 วัน/ปี
  - `ลาพักผ่อนประจำปี (พักร้อน)`: ต้องอายุงาน ≥ 1 ปี
  - `ทำหมัน`, อื่น ๆ: จ่ายเต็ม
  - ⚠️ ถ้า HR เปลี่ยนชื่อประเภทลา กฎเหล่านี้จะไม่ทำงาน
- แก้ใบลาที่รอ HR ได้เฉพาะเจ้าของ, HR, CEO (หัวหน้าแผนกแก้ไม่ได้)

**การอนุมัติ**
- HR: ต้อง lock ก่อน (`PATCH /hr/leaves/:id/view` → `REVIEWING_HR`); HR หนึ่งคน lock ได้ทีละใบ; ใช้ `updateMany` แบบ atomic
- HR อนุมัติ → ผู้ยื่นเป็น Manager/CEO/ตำแหน่ง Leader ไป `PENDING_EXECUTIVE`, คนอื่นไป `PENDING_SUPERVISOR`
- หัวหน้าแผนก (`isDepartmentApprover`): อนุมัติ → `LeaveType.isSpecial` ? `PENDING_EXECUTIVE` : `APPROVED` (ตัดโควตา); ไม่มีใครอนุมัติคำขอของตัวเอง
- CEO อนุมัติ `PENDING_EXECUTIVE` → `APPROVED` (ตัดโควตา); อนุมัติ/ปฏิเสธคำขอของตัวเองไม่ได้
- การปฏิเสธต้องมีเหตุผล (`comment`)
- ทุกขั้นใช้ `updateMany({ where: { id, status: <สถานะที่คาด> } })` ใน transaction กันกดซ้ำ — รักษา pattern นี้ไว้
- ยกเลิกใบที่ผ่าน HR แล้ว → `PENDING_CANCELLATION` → HR อนุมัติ = `CANCELLED` + คืนโควตา / ปฏิเสธ = กลับสถานะล่าสุดใน LeaveApproval

**Auth & ความปลอดภัย**
- Login ต้องมี captcha (`captchaId`, `captchaInput`), lockout ตาม `AdminSetting` (`MAX_FAILED_LOGINS`=5, `LOCKOUT_DURATION_MINUTES`=15); ผู้ใช้ไม่มีจริง/รหัสผิด/ถูกล็อก ตอบข้อความเดียวกัน (กัน enumeration)
- `JwtStrategy` อ่าน user จาก DB ทุก request: ตรวจ `isActive` (ไม่ active → `ACCOUNT_SUSPENDED`) และ `tokenVersion`; role ใน `CurrentUser` มาจาก DB
- เปลี่ยน role → ใช้ `roleChangeSignOut()` เสมอ; force-logout = เพิ่ม `tokenVersion`
- HR กำหนด role ได้ทุกอย่างยกเว้น `Admin` และแก้/ระงับ/ลบบัญชี Admin ไม่ได้ (`hr-assignable-role.ts`)
- ลิงก์ reset password สร้างจาก `FRONTEND_URL`/CORS เท่านั้น (ไม่ใช้ header ของ request)
- Upload: ≤ 2 MB, ตรวจชนิดไฟล์จาก magic bytes (ไม่เชื่อ Content-Type), แทนที่ไฟล์เดิมแบบ atomic
- `AdminSetting` อื่น: `JWT_EXPIRATION`, `IDLE_TIMEOUT_MINUTES` (=60, ส่งให้ frontend ผ่าน `GET /auth/config`)

**Notification**
- สร้าง `Notification` ใน DB + ส่ง email แบบ fire-and-forget (email ล้มเหลวต้องไม่ทำให้ API ล้ม)
- Cron 09:00 ส่งสรุปรายการค้างให้ HR / หัวหน้าแผนก / CEO — **รัน PM2 แค่ instance เดียว (fork)** ไม่งั้น email ซ้ำ

## แนวทางเขียนโค้ด
- Response: return object ธรรมดา หรือ `{ message, data }` — interceptor จะห่อให้ อย่าห่อเอง
- Error: throw `BadRequestException` / `ForbiddenException` / `NotFoundException` พร้อม **ข้อความไทย**
- DTO ใช้ class-validator; field ที่ไม่ประกาศใน DTO จะโดน reject (forbidNonWhitelisted)
- ดึง user ปัจจุบันด้วย `@CurrentUser() user: CurrentUserPayload` (`{ id, email, role }`)
- เขียนหลายตารางให้ใช้ `prisma.$transaction`
- แก้ business logic แล้วรัน spec ที่เกี่ยวข้อง โดยเฉพาะ `modules/leave-business-flow.spec.ts`, `leave-security.spec.ts`, `auth/guards/route-security.spec.ts`

## Deploy
- Windows Server + IIS (URL Rewrite/ARR) + PM2 (`ecosystem.config.js`, `TZ=Asia/Bangkok`)
- เอกสาร: `backend-server-th.md`, `database-server-th.md`; backup script: `deploy/backup/*.ps1`
- `docker-compose.yml` = MySQL 8 สำหรับ dev เท่านั้น
