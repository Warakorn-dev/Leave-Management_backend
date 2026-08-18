-- Preserve the existing workflow while recording the HR reviewer who has opened a request.
-- The application acquires this lock atomically before allowing a decision.
-- isViewedByHr tracks whether any HR user has opened the request (soft view flag).
ALTER TABLE `leaverequest`
  ADD COLUMN `isViewedByHr` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `currentHrReviewerId` VARCHAR(191) NULL,
  ADD COLUMN `hrReviewStartedAt` DATETIME(3) NULL;
