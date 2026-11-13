-- How many days an APPROVED leave took from each year's balance, so a leave
-- that crosses New Year (start-year balance first, the rest from the next
-- year) can be cancelled and refunded to the right years.
-- Leaves approved before this table existed have no rows; their refund falls
-- back to the start-year balance (see leave-balance.util.ts).
CREATE TABLE `leavebalancededuction` (
  `id` VARCHAR(191) NOT NULL,
  `leaveRequestId` VARCHAR(191) NOT NULL,
  `leaveBalanceId` VARCHAR(191) NOT NULL,
  `days` DOUBLE NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `LeaveBalanceDeduction_leaveBalanceId_fkey`(`leaveBalanceId`),
  UNIQUE INDEX `LeaveBalanceDeduction_leaveRequestId_leaveBalanceId_key`(`leaveRequestId`, `leaveBalanceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `leavebalancededuction`
  ADD CONSTRAINT `LeaveBalanceDeduction_leaveRequestId_fkey`
  FOREIGN KEY (`leaveRequestId`) REFERENCES `leaverequest`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `leavebalancededuction`
  ADD CONSTRAINT `LeaveBalanceDeduction_leaveBalanceId_fkey`
  FOREIGN KEY (`leaveBalanceId`) REFERENCES `leavebalance`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
