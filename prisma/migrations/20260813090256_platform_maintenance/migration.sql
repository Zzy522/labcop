-- CreateTable
CREATE TABLE "PlatformMaintenance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT 'Lab Copilot 升级中',
    "message" TEXT NOT NULL DEFAULT '我们正在进行系统升级，请稍后再试。',
    "startsAt" DATETIME,
    "estimatedEndAt" DATETIME,
    "lastNotifiedAt" DATETIME,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "labId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "relatedType" TEXT,
    "relatedId" TEXT,
    "actionUrl" TEXT,
    "readAt" DATETIME,
    "channels" TEXT NOT NULL DEFAULT '["in_app"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Notification" ("actionUrl", "channels", "content", "createdAt", "id", "labId", "priority", "readAt", "recipientId", "relatedId", "relatedType", "title", "type") SELECT "actionUrl", "channels", "content", "createdAt", "id", "labId", "priority", "readAt", "recipientId", "relatedId", "relatedType", "title", "type" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_recipientId_idx" ON "Notification"("recipientId");
CREATE INDEX "Notification_labId_idx" ON "Notification"("labId");
CREATE INDEX "Notification_type_idx" ON "Notification"("type");
CREATE INDEX "Notification_priority_idx" ON "Notification"("priority");
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PlatformMaintenance_enabled_startsAt_idx" ON "PlatformMaintenance"("enabled", "startsAt");
