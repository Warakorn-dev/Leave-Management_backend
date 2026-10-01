-- Records when a user last set their own password (profile change or reset link).
-- NULL = never changed: the first change from the profile page does not ask for
-- the current password; every later change does (business rule 2026-09-24).
ALTER TABLE `user`
  ADD COLUMN `passwordChangedAt` DATETIME(3) NULL;
