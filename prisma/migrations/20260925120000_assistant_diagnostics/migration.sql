-- CreateTable
CREATE TABLE "AssistantRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "harness" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "input" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AssistantRun_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssistantSpan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "input" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantSpan_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AssistantRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssistantCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "expected" TEXT NOT NULL DEFAULT '',
    "assertions" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssistantCase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AssistantRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssistantEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "candidate" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantEvaluation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AssistantCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantRun_messageId_key" ON "AssistantRun"("messageId");

-- CreateIndex
CREATE INDEX "AssistantRun_userId_labId_createdAt_idx" ON "AssistantRun"("userId", "labId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantRun_status_createdAt_idx" ON "AssistantRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantSpan_runId_sequence_key" ON "AssistantSpan"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantCase_runId_key" ON "AssistantCase"("runId");

-- CreateIndex
CREATE INDEX "AssistantCase_status_createdAt_idx" ON "AssistantCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantEvaluation_caseId_createdAt_idx" ON "AssistantEvaluation"("caseId", "createdAt");
