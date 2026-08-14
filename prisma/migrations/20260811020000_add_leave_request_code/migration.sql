-- Add requestCode column to leaverequest table
ALTER TABLE `leaverequest` ADD COLUMN `requestCode` VARCHAR(20) NULL;

-- Backfill existing leave requests with generated codes
-- Format: L-{leaveTypeCode}-{sequence}-{buddhistYear}
SET @row_num = 0;
SET @current_year = 0;

UPDATE `leaverequest` lr
JOIN (
  SELECT
    lr2.id,
    lt.code AS leaveTypeCode,
    YEAR(lr2.createdAt) + 543 AS buddhistYear,
    @row_num := IF(@current_year = YEAR(lr2.createdAt) + 543, @row_num + 1, 1) AS seq,
    @current_year := YEAR(lr2.createdAt) + 543 AS yr
  FROM `leaverequest` lr2
  JOIN `leavetype` lt ON lt.id = lr2.leaveTypeId
  ORDER BY YEAR(lr2.createdAt), lr2.createdAt
) sub ON lr.id = sub.id
SET lr.requestCode = CONCAT('L-', sub.leaveTypeCode, '-', LPAD(sub.seq, 5, '0'), '-', sub.buddhistYear);

-- Make the column NOT NULL and add unique index
ALTER TABLE `leaverequest`
  MODIFY COLUMN `requestCode` VARCHAR(20) NOT NULL,
  ADD UNIQUE INDEX `LeaveRequest_requestCode_key` (`requestCode`);
