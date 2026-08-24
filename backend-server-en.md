# Server Request Document: Backend

## System Name

Employee Leave Management System (Backend/API)

## Server Purpose

This server provides the API layer for the Employee Leave Management System, including login, users, roles, leave requests, approvals, uploads, notifications, exports, and database access.

Based on the actual project structure, the backend is built with NestJS, not Next.js.

## Technology Stack

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
NSSM or PM2
SSL Certificate
```

## Operating System

```text
Windows Server 2022 Standard
or
Windows Server 2025 Standard
```

## Server Users

```text
Administrator
deploy
```

## Recommended Specification

```text
CPU: 2-4 vCPU
RAM: 4-8 GB
Storage: 80-100 GB SSD
```

## Services / Applications

```text
Node.js 20 LTS
NestJS Backend API
Prisma ORM
IIS Reverse Proxy
URL Rewrite
Application Request Routing (ARR)
NSSM or PM2 for service management
SMTP for email delivery
SSL Certificate
```

## Ports

```text
Public HTTPS: 443
Internal NestJS API: 8000
Outbound to Database: 3306
```

## Environment Variables

Required backend environment variables:

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

The backend uses the global API prefix:

```text
/api
```

Example endpoints:

```text
https://api-leave.example.com/api/auth/login
https://api-leave.example.com/api/leave
https://api-leave.example.com/api/hr/employees
```

## Reverse Proxy

Public/backend-facing URL:

```text
https://api-leave.example.com
```

IIS reverse proxy target:

```text
http://127.0.0.1:8000
```

## Network

```text
Internet -> Server 2: TCP 443
Server 1 -> Server 2: TCP 443 or TCP 8000
Server 2 -> Server 3: TCP 3306
```

## Database Connection

The backend connects to MySQL through Prisma and `DATABASE_URL`.

Example:

```env
DATABASE_URL=mysql://leave_app:password@10.0.0.30:3306/leave_management
```

The Database Server should allow MySQL access only from the Backend Server IP address.

## File Upload

In the current codebase, uploaded files are converted to base64 and stored in MySQL LongText fields.

Impact:

```text
No shared folder is required between servers
Database backups include uploaded attachments
The database can grow quickly if many attachments are uploaded
File upload size should be limited
Allowed file types should be restricted, such as PDF, JPG, PNG
```

## Authentication

The system uses:

```text
JWT Access Token
JWT Refresh Token
Bcrypt password hash
Role-based access control
CAPTCHA
```

System roles:

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

For production, the application should run through NSSM or PM2.

## Security

```text
HTTPS is required
Do not expose port 8000 directly to the internet
Expose only port 443 publicly
Restrict CORS to the frontend domain
Replace JWT_SECRET and JWT_REFRESH_SECRET with strong random values
Do not use the database root user
Disable or restrict access to /api-docs
Limit upload file size
Restrict upload file types
Allow MySQL access only from Server 2
```

## Checklist

```text
[ ] Install Windows Server
[ ] Install Node.js 20 LTS
[ ] Install IIS
[ ] Install URL Rewrite
[ ] Install ARR
[ ] Configure SSL certificate
[ ] Configure backend .env
[ ] Test MySQL Server connection
[ ] Run npx prisma generate
[ ] Run npx prisma migrate deploy
[ ] Run npm ci
[ ] Run npm run build
[ ] Create Windows Service using NSSM or PM2
[ ] Configure IIS reverse proxy to port 8000
[ ] Test /api/auth/login
[ ] Test upload
[ ] Test export
[ ] Test email delivery
```

## Summary

The Backend Server can be separated from the Frontend and Database Servers. It acts as the central API layer and connects to MySQL through the private network only.
