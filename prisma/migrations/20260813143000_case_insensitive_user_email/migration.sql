-- 用户邮箱是登录标识：先规范化历史值，再由数据库保证大小写不敏感唯一性。
-- 若历史数据已存在仅大小写不同的重复邮箱，本次 UPDATE/CREATE UNIQUE INDEX 会失败，
-- 应先人工确认并合并账号，避免迁移自动删除任何用户数据。
UPDATE "User" SET "email" = lower(trim("email"));

DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" COLLATE NOCASE);
