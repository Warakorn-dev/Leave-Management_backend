# เอกสารขอ Server: Database

## ชื่อระบบงาน

ระบบจัดการการลาพนักงาน (Database/MySQL)

## วัตถุประสงค์ของ Server

Server นี้ใช้สำหรับเก็บข้อมูลทั้งหมดของระบบจัดการการลาพนักงาน เช่น ข้อมูลผู้ใช้งาน พนักงาน แผนก ตำแหน่ง คำขอลา การอนุมัติ วันหยุด การแจ้งเตือน และไฟล์แนบ

จากโครงสร้างโปรเจกต์จริง ระบบใช้ MySQL ผ่าน Prisma ORM

## เทคโนโลยีที่ใช้

```text
MySQL Server 8.0
Prisma-compatible MySQL database
Windows Task Scheduler สำหรับ backup
MySQL Workbench ถ้าต้องการ GUI
Windows Firewall
```

## ระบบปฏิบัติการ

<<<<<<< HEAD
=======
```text
Windows Server 2022 Standard
หรือ
>>>>>>> 5e1d8dfcd1ecc98e3ee8708e140219d5d2918252
Windows Server 2025 Standard
```

## รายชื่อผู้ใช้งานเครื่อง

```text
Administrator
DBA
backup_user
```

## Spec ที่แนะนำ

```text
CPU: 4 vCPU
<<<<<<< HEAD
RAM: 16 GB
Storage: 500 GB SSD ขึ้นไป
=======
RAM: 8-16 GB
Storage: 200 GB SSD ขึ้นไป
>>>>>>> 5e1d8dfcd1ecc98e3ee8708e140219d5d2918252
```

หมายเหตุ: ระบบ upload ปัจจุบันเก็บไฟล์แนบเป็น base64 ใน MySQL ดังนั้น Database Server ควรมี storage มากกว่า Frontend และ Backend

## Service / Application

```text
MySQL Server 8.0
MySQL Workbench
Windows Task Scheduler
Windows Firewall
Backup storage
Monitoring tool ถ้ามี
```

## Port ที่ใช้

```text
MySQL: 3306
```

ควรเปิดให้เฉพาะ Backend Server เชื่อมต่อเท่านั้น

## Database

```text
<<<<<<< HEAD
Database Name: leave_management-new
Application User: leave_management
=======
Database Name: leave_management
Application User: leave_app
>>>>>>> 5e1d8dfcd1ecc98e3ee8708e140219d5d2918252
Backup User: backup_user
```

## ตัวอย่าง DATABASE_URL

Backend Server จะเชื่อมต่อ Database Server ด้วย:

```env
DATABASE_URL=mysql://leave_app:STRONG_PASSWORD@10.0.0.30:3306/leave_management
```

## Network

ตัวอย่าง IP:

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

Migration ควรรันจาก Backend Server:

```powershell
cd C:\app\Leave-Management_backend
npx prisma migrate deploy
```

ไม่ควรรัน migration แบบ manual ใน production หากไม่จำเป็น

## Backup

แนะนำใช้ `mysqldump` ผ่าน Windows Task Scheduler

ตัวอย่าง:

```bat
mysqldump -h 127.0.0.1 -u backup_user -p leave_management > D:\backup\leave_management_backup.sql
```

รูปแบบ retention ที่แนะนำ:

```text
Daily backup: เก็บ 7 วัน
Weekly backup: เก็บ 4 สัปดาห์
Monthly backup: เก็บ 6-12 เดือน
```

ควรทดสอบ restore อย่างน้อยเดือนละครั้ง

## Security

```text
ไม่เปิด MySQL port 3306 ออก internet
อนุญาตเฉพาะ IP ของ Backend Server
ไม่ใช้ root user ใน application
สร้าง user leave_app เฉพาะ database leave_management
สร้าง backup_user แยกต่างหาก
ตั้งรหัสผ่านที่ strong
เปิด Windows Firewall
ตั้ง backup อัตโนมัติ
เก็บ backup แยกจากเครื่อง database อย่างน้อยหนึ่งชุด
```

## Checklist

```text
[ ] ติดตั้ง Windows Server
[ ] ติดตั้ง MySQL Server 8.0
[ ] สร้าง database leave_management
[ ] สร้าง user leave_app
[ ] สร้าง user backup_user
[ ] ตั้ง firewall เปิด port 3306 เฉพาะ Server 2
[ ] ทดสอบ connection จาก Backend Server
[ ] รัน Prisma migration จาก Backend Server
[ ] ตั้ง Windows Task Scheduler สำหรับ backup
[ ] ทดสอบ backup
[ ] ทดสอบ restore
[ ] ตั้ง monitoring หรือ disk alert
```

## สรุป

Database Server ควรเป็น server ที่อยู่ใน private network และรับ connection เฉพาะจาก Backend Server เท่านั้น เนื่องจากข้อมูลระบบและไฟล์แนบถูกเก็บไว้ใน MySQL จึงต้องให้ความสำคัญกับ storage, backup, security และ restore test
