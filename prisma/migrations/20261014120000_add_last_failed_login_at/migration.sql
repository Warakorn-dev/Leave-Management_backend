-- Time of the latest wrong password. Failed logins count toward the lockout
-- only while they are within LOCKOUT_DURATION_MINUTES of each other
-- ("5 times within 15 minutes", business decision 2026-10-14, D-08).
ALTER TABLE `user`
  ADD COLUMN `lastFailedLoginAt` DATETIME(3) NULL;
