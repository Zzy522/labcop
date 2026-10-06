ALTER TABLE "Reagent" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Reagent" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN "processingToken" TEXT;
ALTER TABLE "Document" ADD COLUMN "processingLeaseAt" DATETIME;
CREATE TABLE "BusinessOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "labId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "response" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BusinessOperation_labId_userId_operation_key_key" ON "BusinessOperation"("labId", "userId", "operation", "key");
DROP INDEX "EntityMemory_userId_entityType_name_key";
CREATE UNIQUE INDEX "EntityMemory_userId_labId_entityType_name_key" ON "EntityMemory"("userId", "labId", "entityType", "name");
-- Only backfill unambiguous ownership. Existing mismatches remain for operator reconciliation.
UPDATE "Requisition" SET "labId" = (SELECT "labId" FROM "Reagent" WHERE "Reagent"."id" = "Requisition"."reagentId") WHERE "labId" IS NULL;
UPDATE "RiskEvent" SET "labId" = (SELECT "labId" FROM "Reagent" WHERE "Reagent"."id" = "RiskEvent"."reagentId") WHERE "labId" IS NULL AND "reagentId" IS NOT NULL AND "deviceId" IS NULL;
UPDATE "RiskEvent" SET "labId" = (SELECT "labId" FROM "Device" WHERE "Device"."id" = "RiskEvent"."deviceId") WHERE "labId" IS NULL AND "deviceId" IS NOT NULL AND "reagentId" IS NULL;
