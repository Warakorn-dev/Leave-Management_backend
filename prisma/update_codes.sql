-- Drop unique constraint temporarily to avoid conflicts during reorder
ALTER TABLE `leavetype` DROP INDEX `LeaveType_code_key`;

-- Assign the 3 specific codes the user requested
UPDATE `leavetype` SET `code` = '01' WHERE `name` = 'ลาป่วย';
UPDATE `leavetype` SET `code` = '02' WHERE `name` = 'ลากิจ';
UPDATE `leavetype` SET `code` = '04' WHERE `name` = 'ลาพักผ่อนประจำปี';

-- Number the remaining leave types starting from 05
SET @code_counter = 4;
UPDATE `leavetype`
SET `code` = LPAD((@code_counter := @code_counter + 1), 2, '0')
WHERE `name` NOT IN ('ลาป่วย', 'ลากิจ', 'ลาพักผ่อนประจำปี')
ORDER BY `createdAt`;

-- Re-add unique constraint
ALTER TABLE `leavetype` ADD UNIQUE INDEX `LeaveType_code_key` (`code`);
