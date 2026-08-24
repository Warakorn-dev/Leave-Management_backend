# Server Request Document: Database

## System Name

Employee Leave Management System (Database/MySQL)

## Server Purpose

This server stores all data for the Employee Leave Management System, including users, employees, departments, positions, leave requests, approvals, holidays, notifications, and attachments.

Based on the actual project structure, the system uses MySQL through Prisma ORM.

## Technology Stack

```text
MySQL Server 8.0
Prisma-compatible MySQL database
Windows Task Scheduler for backups
MySQL Workbench if GUI access is required
Windows Firewall
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
DBA
backup_user
```

## Recommended Specification

```text
CPU: 4 vCPU
RAM: 8-16 GB
Storage: 200 GB SSD or higher
```

Note: The current upload implementation stores attachments as base64 data in MySQL, so the Database Server should have more storage than the Frontend and Backend Servers.

## Services / Applications

```text
MySQL Server 8.0
MySQL Workbench
Windows Task Scheduler
Windows Firewall
Backup storage
Monitoring tool if available
```

## Port

```text
MySQL: 3306
```

This port should be accessible only from the Backend Server.

## Database

```text
Database Name: leave_management
Application User: leave_app
Backup User: backup_user
```

## Example DATABASE_URL

The Backend Server connects to the Database Server using:

```env
DATABASE_URL=mysql://leave_app:STRONG_PASSWORD@10.0.0.30:3306/leave_management
```

## Network

Example IP addresses:

```text
Server 1 Frontend: 10.0.0.10
Server 2 Backend: 10.0.0.20
Server 3 Database: 10.0.0.30
```

Firewall:

```text
Allow Server 2 -> Server 3: TCP 3306
Block Internet -> Server 3: TCP 3306
Block Server 1 -> Server 3: TCP 3306
```

## Database Migration

Migrations should be executed from the Backend Server:

```powershell
cd C:\app\Leave-Management_backend
npx prisma migrate deploy
```

Manual production database changes should be avoided unless required.

## Backup

Use `mysqldump` with Windows Task Scheduler.

Example:

```bat
mysqldump -h 127.0.0.1 -u backup_user -p leave_management > D:\backup\leave_management_backup.sql
```

Recommended retention:

```text
Daily backup: keep 7 days
Weekly backup: keep 4 weeks
Monthly backup: keep 6-12 months
```

A restore test should be performed at least once per month.

## Security

```text
Do not expose MySQL port 3306 to the internet
Allow access only from the Backend Server IP
Do not use the root user for the application
Create a dedicated leave_app user for the leave_management database
Create a separate backup_user
Use strong passwords
Enable Windows Firewall
Configure automated backups
Store at least one backup copy outside the Database Server
```

## Checklist

```text
[ ] Install Windows Server
[ ] Install MySQL Server 8.0
[ ] Create leave_management database
[ ] Create leave_app user
[ ] Create backup_user
[ ] Configure firewall to allow port 3306 only from Server 2
[ ] Test connection from Backend Server
[ ] Run Prisma migration from Backend Server
[ ] Configure Windows Task Scheduler for backup
[ ] Test backup
[ ] Test restore
[ ] Configure monitoring or disk alert
```

## Summary

The Database Server should be placed in a private network and accept connections only from the Backend Server. Since application data and uploaded attachments are stored in MySQL, storage, backups, security, and restore testing are critical.
