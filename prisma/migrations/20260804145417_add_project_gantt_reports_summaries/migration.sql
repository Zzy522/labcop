-- CreateTable
CREATE TABLE "ProjectTaskUpdate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectTaskUpdate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectPhaseTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectTaskUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectWeeklyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "blockers" TEXT,
    "nextPlan" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectWeeklyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectWeeklyReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectAiSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "usedVision" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectAiSummary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectAiSummary_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
INSERT INTO "new_ProjectPhaseTask" ("blockedReason", "completedAt", "createdAt", "createdById", "deletedAt", "description", "dueDate", "id", "name", "parentId", "priority", "progress", "projectId", "startDate", "status", "updatedAt", "updatedById", "version") SELECT "blockedReason", "completedAt", "createdAt", "createdById", "deletedAt", "description", "dueDate", "id", "name", "parentId", "priority", "progress", "projectId", "startDate", "status", "updatedAt", "updatedById", "version" FROM "ProjectPhaseTask";
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
CREATE INDEX "ProjectTaskUpdate_taskId_createdAt_idx" ON "ProjectTaskUpdate"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectTaskUpdate_authorId_idx" ON "ProjectTaskUpdate"("authorId");

-- CreateIndex
CREATE INDEX "ProjectWeeklyReport_projectId_weekStart_idx" ON "ProjectWeeklyReport"("projectId", "weekStart");

-- CreateIndex
CREATE INDEX "ProjectWeeklyReport_authorId_createdAt_idx" ON "ProjectWeeklyReport"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAiSummary_projectId_createdAt_idx" ON "ProjectAiSummary"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAiSummary_requestedById_idx" ON "ProjectAiSummary"("requestedById");
