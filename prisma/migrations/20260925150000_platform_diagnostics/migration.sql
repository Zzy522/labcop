ALTER TABLE "AssistantRun" ADD COLUMN "captureContent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AssistantRun" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AssistantRun" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "AssistantRun" ADD COLUMN "purgedAt" DATETIME;
UPDATE "AssistantRun" SET "expiresAt" = (CAST(strftime('%s','now') AS INTEGER) + 2592000) * 1000;
UPDATE "AssistantRun" SET "shared" = true, "captureContent" = true WHERE "id" IN (SELECT "runId" FROM "AssistantCase");
CREATE TABLE "AssistantDiagnosticPolicy" ("labId" TEXT NOT NULL PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT false, "expiresAt" DATETIME, "retentionDays" INTEGER NOT NULL DEFAULT 30, "updatedBy" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL);
CREATE TABLE "AssistantDiagnosticGrant" ("userId" TEXT NOT NULL PRIMARY KEY, "canReadContent" BOOLEAN NOT NULL DEFAULT false, "canExport" BOOLEAN NOT NULL DEFAULT false, "labIds" TEXT NOT NULL DEFAULT '[]', "updatedAt" DATETIME NOT NULL);
INSERT INTO "AssistantDiagnosticGrant" ("userId", "canReadContent", "canExport", "labIds", "updatedAt") SELECT "id", true, true, '[]', CURRENT_TIMESTAMP FROM "User" WHERE "platformRole" = 'PLATFORM_ADMIN' AND "status" = 'ACTIVE';
CREATE INDEX "AssistantRun_expiresAt_idx" ON "AssistantRun"("expiresAt");

ALTER TABLE "AssistantRun" ADD COLUMN "firstTokenMs" INTEGER;
ALTER TABLE "AssistantSpan" ADD COLUMN "parentId" TEXT;

ALTER TABLE "AssistantCase" ADD COLUMN "owner" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AssistantCase" ADD COLUMN "rootCause" TEXT NOT NULL DEFAULT '';
