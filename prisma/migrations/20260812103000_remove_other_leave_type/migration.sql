-- This leave type is not required by the final business flow.
-- It has no request or balance records in the target database.
DELETE FROM `leavetype`
WHERE `name` = 'ลากรณีอื่น ๆ';
