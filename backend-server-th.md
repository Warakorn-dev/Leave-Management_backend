# เอกสารขอ Server: Backend

## ชื่อระบบงาน

ระบบจัดการการลาพนักงาน (Backend/API)

## วัตถุประสงค์ของ Server

Server นี้ใช้สำหรับให้บริการ API ของระบบจัดการการลาพนักงาน เช่น login, user, role, leave request, approval, upload, notification, export และการเชื่อมต่อฐานข้อมูล

จากโครงสร้างโปรเจกต์จริง Backend พัฒนาด้วย NestJS ไม่ใช่ Next.js

## เทคโนโลยีที่ใช้

```text
NestJS 11
Node.js 20 LTS
Prisma
MySQL Client
JWT Authentication
Bcrypt
Nodemailer / SMTP
IIS
IIS URL Rewrite
Application Request Routing (ARR)
NSSM หรือ PM2
SSL Certificate
```

## ระบบปฏิบัติการ

```text
Windows Server 2022 Standard
หรือ
Windows Server 2025 Standard
```

## รายชื่อผู้ใช้งานเครื่อง

```text
Administrator
deploy
```

## Spec ที่แนะนำ

```text
CPU: 2-4 vCPU
RAM: 4-8 GB
Storage: 80-100 GB SSD
```

## Service / Application

```text
Node.js 20 LTS
NestJS Backend API
Prisma ORM
IIS Reverse Proxy
URL Rewrite
Application Request Routing (ARR)
NSSM หรือ PM2 สำหรับรัน service
SMTP สำหรับส่ง email
SSL Certificate
```

## Port ที่ใช้

```text
Public HTTPS: 443
Internal NestJS API: 8000
Outbound to Database: 3306
```

## Environment Variables

ตัวแปรสำคัญของ Backend:

```env
NODE_ENV=production
PORT=8000
DATABASE_URL=mysql://leave_app:STRONG_PASSWORD@10.0.0.30:3306/leave_management
JWT_SECRET=CHANGE_TO_LONG_RANDOM_SECRET
JWT_REFRESH_SECRET=CHANGE_TO_ANOTHER_LONG_RANDOM_SECRET
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d
CORS_ORIGINS=https://leave.example.com
FRONTEND_URL=https://leave.example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=mail_user@example.com
SMTP_PASS=SMTP_PASSWORD
```

## API Endpoint

Backend ใช้ global prefix เป็น:

```text
/api
```

ตัวอย่าง endpoint:

```text
https://api-leave.example.com/api/auth/login
https://api-leave.example.com/api/leave
https://api-leave.example.com/api/hr/employees
```

## Reverse Proxy

ผู้ใช้งานหรือ Frontend เรียก:

```text
https://api-leave.example.com
```

IIS reverse proxy ไปที่:

```text
http://127.0.0.1:8000
```

## Network

```text
Internet -> Server 2: TCP 443
Server 1 -> Server 2: TCP 443 หรือ TCP 8000
Server 2 -> Server 3: TCP 3306
```

## Database Connection

Backend เชื่อมต่อ MySQL ผ่าน Prisma และ `DATABASE_URL`

ตัวอย่าง:

```env
DATABASE_URL=mysql://leave_app:password@10.0.0.30:3306/leave_management
```

Database Server ควรอนุญาตเฉพาะ IP ของ Backend Server ให้เชื่อมต่อ port 3306

## File Upload

จากโค้ดปัจจุบัน ระบบ upload แปลงไฟล์เป็น base64 แล้วเก็บใน MySQL field ประเภท LongText

ผลกระทบ:

```text
ไม่ต้องทำ shared folder ระหว่าง server
backup database จะรวมไฟล์แนบด้วย
database จะโตเร็วหากมีไฟล์แนบจำนวนมาก
ควรจำกัดขนาดไฟล์ upload
ควรจำกัดประเภทไฟล์ เช่น PDF, JPG, PNG
```

## Authentication

ระบบใช้:

```text
JWT Access Token
JWT Refresh Token
Bcrypt password hash
Role-based access control
CAPTCHA
```

Role ในระบบ:

```text
Employee / User
Manager
HR
CEO
```

## Production Build

```powershell
cd C:\app\Leave-Management_backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start:prod
```

สำหรับ production ควรรันผ่าน NSSM หรือ PM2

## Security

```text
ต้องใช้ HTTPS เท่านั้น
ไม่ควรเปิด port 8000 ออก internet โดยตรง
เปิด public เฉพาะ port 443
จำกัด CORS เฉพาะ frontend domain
เปลี่ยน JWT_SECRET และ JWT_REFRESH_SECRET เป็นค่าที่สุ่มใหม่
ไม่ใช้ database root user
ปิดหรือจำกัดการเข้าถึง /api-docs
จำกัดขนาด file upload
จำกัดประเภท file upload
ตั้ง firewall ให้ต่อ MySQL ได้เฉพาะ Server 2
```

## Checklist

```text
[ ] ติดตั้ง Windows Server
[ ] ติดตั้ง Node.js 20 LTS
[ ] ติดตั้ง IIS
[ ] ติดตั้ง URL Rewrite
[ ] ติดตั้ง ARR
[ ] ตั้งค่า SSL certificate
[ ] ตั้งค่า backend .env
[ ] ทดสอบเชื่อมต่อ MySQL Server
[ ] รัน npx prisma generate
[ ] รัน npx prisma migrate deploy
[ ] รัน npm ci
[ ] รัน npm run build
[ ] สร้าง Windows Service ด้วย NSSM หรือ PM2
[ ] ตั้ง IIS reverse proxy ไป port 8000
[ ] ทดสอบ /api/auth/login
[ ] ทดสอบ upload
[ ] ทดสอบ export
[ ] ทดสอบ email
```

## สรุป

Backend Server สามารถแยกออกจาก Frontend และ Database ได้ โดยทำหน้าที่เป็น API กลางและเชื่อมต่อ MySQL ผ่าน private network เท่านั้น
