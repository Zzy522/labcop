-- CreateTable
CREATE TABLE "OnboardingProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "guideKey" TEXT NOT NULL,
    "guideVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "lastStep" INTEGER NOT NULL DEFAULT 0,
    "doNotAutoPrompt" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OnboardingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "assistantMode" TEXT NOT NULL DEFAULT 'MANAGEMENT',
    "title" TEXT NOT NULL DEFAULT '新会话',
    "summary" TEXT,
    "summarizedMessageIds" TEXT,
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatSession_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ChatSession" ("createdAt", "deletedAt", "id", "labId", "lastActiveAt", "role", "summarizedMessageIds", "summary", "title", "tokenEstimate", "updatedAt", "userId") SELECT "createdAt", "deletedAt", "id", "labId", "lastActiveAt", "role", "summarizedMessageIds", "summary", "title", "tokenEstimate", "updatedAt", "userId" FROM "ChatSession";
DROP TABLE "ChatSession";
ALTER TABLE "new_ChatSession" RENAME TO "ChatSession";
CREATE INDEX "ChatSession_userId_idx" ON "ChatSession"("userId");
CREATE INDEX "ChatSession_labId_idx" ON "ChatSession"("labId");
CREATE INDEX "ChatSession_assistantMode_idx" ON "ChatSession"("assistantMode");
CREATE INDEX "ChatSession_lastActiveAt_idx" ON "ChatSession"("lastActiveAt");
CREATE INDEX "ChatSession_deletedAt_idx" ON "ChatSession"("deletedAt");
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "recognitionResult" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "labId" TEXT,
    "reagentId" TEXT,
    "reagentLogId" TEXT,
    "processingMode" TEXT NOT NULL DEFAULT 'OCR',
    "receiptDate" DATETIME,
    "archiveNote" TEXT,
    "reagentName" TEXT,
    "casNumber" TEXT,
    "brand" TEXT,
    "riskLevel" TEXT,
    "isHazardous" BOOLEAN,
    "isControlled" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Document_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_reagentLogId_fkey" FOREIGN KEY ("reagentLogId") REFERENCES "ReagentLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("brand", "casNumber", "createdAt", "fileName", "fileSize", "fileUrl", "id", "isControlled", "isHazardous", "labId", "mimeType", "reagentId", "reagentName", "recognitionResult", "riskLevel", "status", "type", "uploadedById") SELECT "brand", "casNumber", "createdAt", "fileName", "fileSize", "fileUrl", "id", "isControlled", "isHazardous", "labId", "mimeType", "reagentId", "reagentName", "recognitionResult", "riskLevel", "status", "type", "uploadedById" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_reagentLogId_idx" ON "Document"("reagentLogId");
CREATE INDEX "Document_processingMode_idx" ON "Document"("processingMode");
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");
CREATE INDEX "Document_labId_idx" ON "Document"("labId");
CREATE INDEX "Document_reagentId_idx" ON "Document"("reagentId");
CREATE INDEX "Document_reagentName_idx" ON "Document"("reagentName");
CREATE INDEX "Document_casNumber_idx" ON "Document"("casNumber");
CREATE INDEX "Document_riskLevel_idx" ON "Document"("riskLevel");
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");
CREATE INDEX "Document_type_idx" ON "Document"("type");
CREATE INDEX "Document_status_idx" ON "Document"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OnboardingProgress_userId_status_idx" ON "OnboardingProgress"("userId", "status");

-- CreateIndex
CREATE INDEX "OnboardingProgress_guideKey_guideVersion_idx" ON "OnboardingProgress"("guideKey", "guideVersion");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingProgress_userId_guideKey_guideVersion_key" ON "OnboardingProgress"("userId", "guideKey", "guideVersion");
