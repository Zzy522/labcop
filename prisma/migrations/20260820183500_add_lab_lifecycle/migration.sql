ALTER TABLE "Lab" ADD COLUMN "deletionPreviousStatus" TEXT;
ALTER TABLE "Lab" ADD COLUMN "deletionRequestedAt" DATETIME;
ALTER TABLE "Lab" ADD COLUMN "deletionScheduledAt" DATETIME;
ALTER TABLE "Lab" ADD COLUMN "deletionRequestedById" TEXT;
ALTER TABLE "Lab" ADD COLUMN "deletedAt" DATETIME;

CREATE INDEX "Lab_status_deletionScheduledAt_idx"
ON "Lab"("status", "deletionScheduledAt");
