-- Preserve the existing workflow while recording the HR reviewer who has opened a request.
-- The application acquires this lock atomically before allowing a decision.
ALTER TABLE `leaverequest`
  ADD COLUMN `currentHrReviewerId` VARCHAR(191) NULL,
  ADD COLUMN `hrReviewStartedAt` DATETIME(3) NULL;
