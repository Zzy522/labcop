-- Extend OCR document records so original receipts can be stored, filtered and linked to stocked reagents.
ALTER TABLE "Document" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "Document" ADD COLUMN "fileSize" INTEGER;
ALTER TABLE "Document" ADD COLUMN "reagentId" TEXT;
ALTER TABLE "Document" ADD COLUMN "reagentName" TEXT;
ALTER TABLE "Document" ADD COLUMN "casNumber" TEXT;
ALTER TABLE "Document" ADD COLUMN "brand" TEXT;
ALTER TABLE "Document" ADD COLUMN "riskLevel" TEXT;
ALTER TABLE "Document" ADD COLUMN "isHazardous" BOOLEAN;
ALTER TABLE "Document" ADD COLUMN "isControlled" BOOLEAN;

CREATE INDEX "Document_reagentId_idx" ON "Document"("reagentId");
CREATE INDEX "Document_reagentName_idx" ON "Document"("reagentName");
CREATE INDEX "Document_casNumber_idx" ON "Document"("casNumber");
CREATE INDEX "Document_riskLevel_idx" ON "Document"("riskLevel");
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");
