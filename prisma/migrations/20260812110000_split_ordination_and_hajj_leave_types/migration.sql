-- Split the combined leave category so each leave purpose has its own balance
-- and approval history. Existing combined requests remain under ordination leave.
UPDATE `leavetype`
SET `name` = 'ลาอุปสมบท', `code` = '08'
WHERE `name` = 'ลาอุปสมบท/ลาไปประกอบพิธีฮัจย์';

-- Create the Hajj leave category if it does not exist yet.
INSERT INTO `leavetype` (`id`, `code`, `name`, `defaultDays`, `requiresCertificate`, `isSpecial`, `advanceNoticeDays`, `minTenureDays`, `createdAt`, `updatedAt`)
SELECT UUID(), '09', 'ลาไปประกอบพิธีฮัจย์', 120, 1, 1, 0, 0, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `leavetype` WHERE `name` = 'ลาไปประกอบพิธีฮัจย์'
);

-- Give every existing employee an independent balance for the new leave type
-- in every year where they already have leave balances.
INSERT INTO `leavebalance` (`id`, `employeeId`, `leaveTypeId`, `year`, `totalDays`, `usedDays`, `remainingDays`, `createdAt`, `updatedAt`)
SELECT UUID(), years.`employeeId`, hajj.`id`, years.`year`, hajj.`defaultDays`, 0, hajj.`defaultDays`, NOW(), NOW()
FROM (
  SELECT DISTINCT `employeeId`, `year`
  FROM `leavebalance`
) AS years
CROSS JOIN (
  SELECT `id`, `defaultDays`
  FROM `leavetype`
  WHERE `name` = 'ลาไปประกอบพิธีฮัจย์'
) AS hajj
WHERE NOT EXISTS (
  SELECT 1
  FROM `leavebalance` AS balance
  WHERE balance.`employeeId` = years.`employeeId`
    AND balance.`leaveTypeId` = hajj.`id`
    AND balance.`year` = years.`year`
);
