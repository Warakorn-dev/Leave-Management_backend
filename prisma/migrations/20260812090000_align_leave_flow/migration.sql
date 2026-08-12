-- Align existing leave types with the documented approval workflow.
-- Sick leave and personal leave finish at the supervisor. All other leave
-- types require executive approval after supervisor approval.
UPDATE `leavetype`
SET `isSpecial` = 1
WHERE `name` LIKE '%พักผ่อน%'
   OR `name` LIKE '%คลอดบุตร%'
   OR `name` LIKE '%อุปสมบท%'
   OR `name` LIKE '%ฮัจย์%'
   OR `name` LIKE '%กรณีอื่น%';

-- Add the two documented types if this database was created before they were
-- included in the application seed data. UUID() is supported by MySQL.
INSERT INTO `leavetype` (`id`, `code`, `name`, `defaultDays`, `requiresCertificate`, `isSpecial`, `advanceNoticeDays`, `minTenureDays`, `createdAt`, `updatedAt`)
SELECT UUID(), LPAD(COALESCE(MAX(CAST(`code` AS UNSIGNED)), 0) + 1, 2, '0'), 'ลาอุปสมบท/ลาไปประกอบพิธีฮัจย์', 120, 1, 1, 0, 0, NOW(), NOW()
FROM `leavetype`
WHERE NOT EXISTS (SELECT 1 FROM `leavetype` WHERE `name` = 'ลาอุปสมบท/ลาไปประกอบพิธีฮัจย์');

INSERT INTO `leavetype` (`id`, `code`, `name`, `defaultDays`, `requiresCertificate`, `isSpecial`, `advanceNoticeDays`, `minTenureDays`, `createdAt`, `updatedAt`)
SELECT UUID(), LPAD(COALESCE(MAX(CAST(`code` AS UNSIGNED)), 0) + 1, 2, '0'), 'ลากรณีอื่น ๆ', 30, 1, 1, 0, 0, NOW(), NOW()
FROM `leavetype`
WHERE NOT EXISTS (SELECT 1 FROM `leavetype` WHERE `name` = 'ลากรณีอื่น ๆ');
