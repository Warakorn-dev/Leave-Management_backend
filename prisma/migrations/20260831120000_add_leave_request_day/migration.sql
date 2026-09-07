-- Per-day breakdown of a leave request's start/end range, so a multi-day
-- request can record that one of its middle days only claimed a half (e.g.
-- a 3-day full-day request where the middle day's morning was already
-- booked elsewhere, so only its afternoon got claimed -> 2.5 days total).
-- See leave-portion.util.ts (planDayPortions) and employee.service.ts.
CREATE TABLE `leaverequestday` (
  `id` VARCHAR(191) NOT NULL,
  `leaveRequestId` VARCHAR(191) NOT NULL,
  `date` DATETIME(3) NOT NULL,
  `portion` VARCHAR(191) NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `LeaveRequestDay_leaveRequestId_fkey`(`leaveRequestId`),
  UNIQUE INDEX `LeaveRequestDay_leaveRequestId_date_key`(`leaveRequestId`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `leaverequestday`
  ADD CONSTRAINT `LeaveRequestDay_leaveRequestId_fkey`
  FOREIGN KEY (`leaveRequestId`) REFERENCES `leaverequest`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
