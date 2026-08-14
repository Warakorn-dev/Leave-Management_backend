-- Add a two-digit, sequential identifier for each leave type.
ALTER TABLE `leavetype` ADD COLUMN `code` CHAR(2) NULL;

-- Keep the requested codes first, then number all remaining existing types.
SET @leave_type_code = 0;
UPDATE `leavetype`
SET `code` = LPAD((@leave_type_code := @leave_type_code + 1), 2, '0')
ORDER BY
  CASE
    WHEN `name` = 'ลาป่วย' THEN 1
    WHEN `name` LIKE 'ลากิจ%' THEN 2
    ELSE 3
  END,
  `createdAt`,
  `id`;

ALTER TABLE `leavetype`
  MODIFY COLUMN `code` CHAR(2) NOT NULL,
  ADD UNIQUE INDEX `LeaveType_code_key` (`code`);
