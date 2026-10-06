-- CreateTable
CREATE TABLE "ProjectWeeklyReportAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "backupUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectWeeklyReportAttachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProjectWeeklyReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectBackupSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectBackupSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectPhaseTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATETIME,
    "dueDate" DATETIME,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "estimatedWeeks" INTEGER NOT NULL DEFAULT 1,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "blockedReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectPhaseTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectPhaseTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectPhaseTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProjectPhaseTask" ("blockedReason", "completedAt", "createdAt", "createdById", "deletedAt", "description", "dueDate", "id", "name", "parentId", "priority", "progress", "projectId", "startDate", "status", "tags", "updatedAt", "updatedById", "version") SELECT "blockedReason", "completedAt", "createdAt", "createdById", "deletedAt", "description", "dueDate", "id", "name", "parentId", "priority", "progress", "projectId", "startDate", "status", "tags", "updatedAt", "updatedById", "version" FROM "ProjectPhaseTask";
DROP TABLE "ProjectPhaseTask";
ALTER TABLE "new_ProjectPhaseTask" RENAME TO "ProjectPhaseTask";
CREATE INDEX "ProjectPhaseTask_projectId_idx" ON "ProjectPhaseTask"("projectId");
CREATE INDEX "ProjectPhaseTask_parentId_idx" ON "ProjectPhaseTask"("parentId");
CREATE INDEX "ProjectPhaseTask_status_idx" ON "ProjectPhaseTask"("status");
CREATE INDEX "ProjectPhaseTask_dueDate_idx" ON "ProjectPhaseTask"("dueDate");
CREATE INDEX "ProjectPhaseTask_deletedAt_idx" ON "ProjectPhaseTask"("deletedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ProjectWeeklyReportAttachment_reportId_idx" ON "ProjectWeeklyReportAttachment"("reportId");

-- CreateIndex
CREATE INDEX "ProjectWeeklyReportAttachment_sha256_idx" ON "ProjectWeeklyReportAttachment"("sha256");

-- CreateIndex
CREATE INDEX "ProjectBackupSnapshot_projectId_createdAt_idx" ON "ProjectBackupSnapshot"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectBackupSnapshot_entityType_entityId_idx" ON "ProjectBackupSnapshot"("entityType", "entityId");
