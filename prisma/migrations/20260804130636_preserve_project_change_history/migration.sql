-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeData" TEXT,
    "afterData" TEXT,
    "source" TEXT NOT NULL DEFAULT 'DIRECT',
    "requestId" TEXT,
    "operatorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectChangeLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectChangeLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProjectChangeLog" ("action", "afterData", "beforeData", "createdAt", "entityId", "entityType", "id", "operatorId", "projectId", "reason", "requestId", "source") SELECT "action", "afterData", "beforeData", "createdAt", "entityId", "entityType", "id", "operatorId", "projectId", "reason", "requestId", "source" FROM "ProjectChangeLog";
DROP TABLE "ProjectChangeLog";
ALTER TABLE "new_ProjectChangeLog" RENAME TO "ProjectChangeLog";
CREATE INDEX "ProjectChangeLog_projectId_createdAt_idx" ON "ProjectChangeLog"("projectId", "createdAt");
CREATE INDEX "ProjectChangeLog_entityType_entityId_idx" ON "ProjectChangeLog"("entityType", "entityId");
CREATE INDEX "ProjectChangeLog_operatorId_idx" ON "ProjectChangeLog"("operatorId");
CREATE INDEX "ProjectChangeLog_requestId_idx" ON "ProjectChangeLog"("requestId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
