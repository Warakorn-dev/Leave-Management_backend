-- Existing installations may name annual leave "ลาพักร้อน" rather than
-- "ลาพักผ่อน". Both names require executive approval after supervisor.
UPDATE `leavetype`
SET `isSpecial` = 1
WHERE `name` LIKE '%พักผ่อน%'
   OR `name` LIKE '%พักร้อน%';
