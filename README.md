# Leave Management System - Backend

Enterprise-grade Leave Management System backend built with NestJS, Prisma, and MySQL.

## Features
- **Clean Architecture & SOLID Principles**
- **Authentication & Security:** JWT, Refresh Tokens, Bcrypt, Helmet, CORS, Rate Limiting (Throttler).
- **Role-Based Access Control (RBAC):** Roles (Employee, Manager, HR, CEO).
- **Modules:**
  - **Employee:** Leave requests, balance checking, and history.
  - **Manager:** Pending requests approval/rejection.
  - **HR:** Employee, Department, Position, LeaveType management.
  - **CEO:** Dashboard, Company/Department Reports, Special Leave Approval.
  - **Upload:** File attachments (PDF, DOCX, PNG, JPG) using Multer.
  - **Notification:** Email notifications using Nodemailer and Cron Jobs.
  - **Export:** Export data to Excel and PDF formats.
- **API Documentation:** Swagger UI.
- **Database:** MySQL via Prisma ORM.

## Setup Instructions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Update the `.env` file with your database and email credentials.
   ```env
   DATABASE_URL="mysql://user:password@localhost:3306/leave_management"
   PORT=3000
   JWT_SECRET="super-secret-key"
   JWT_REFRESH_SECRET="super-secret-refresh-key"
   ```

3. **Start Database (Docker):**
   ```bash
   docker-compose up -d
   ```

4. **Initialize Database:**
   ```bash
   npx prisma migrate dev --name init
   npm run prisma:seed
   ```

5. **Run the Application:**
   ```bash
   npm run start:dev
   ```

## API Documentation
Once the server is running, visit the Swagger documentation at:
`http://localhost:3000/api-docs`

## Testing
```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e
```
