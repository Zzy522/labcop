-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchProject_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "addedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectPhaseTask" (
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

-- CreateTable
CREATE TABLE "ProjectTaskAssignee" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("taskId", "userId"),
    CONSTRAINT "ProjectTaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectPhaseTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectTaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectTaskChangeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "patchData" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewComment" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectTaskChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectTaskChangeRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectPhaseTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectTaskChangeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectTaskChangeRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" TEXT NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectDocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "changeNote" TEXT,
    "extractedText" TEXT,
    "aiSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "uploadedById" TEXT NOT NULL,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectDocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectDocumentReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectDocumentReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectDocumentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectDocumentReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectCompound" (
    "projectId" TEXT NOT NULL,
    "compoundId" TEXT NOT NULL,
    "role" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("projectId", "compoundId"),
    CONSTRAINT "ProjectCompound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectCompound_compoundId_fkey" FOREIGN KEY ("compoundId") REFERENCES "Compound" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectChangeLog" (
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
    CONSTRAINT "ProjectChangeLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ResearchProject_labId_idx" ON "ResearchProject"("labId");

-- CreateIndex
CREATE INDEX "ResearchProject_status_idx" ON "ResearchProject"("status");

-- CreateIndex
CREATE INDEX "ResearchProject_updatedAt_idx" ON "ResearchProject"("updatedAt");

-- CreateIndex
CREATE INDEX "ResearchProject_deletedAt_idx" ON "ResearchProject"("deletedAt");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_role_idx" ON "ProjectMember"("projectId", "role");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "ProjectPhaseTask_projectId_idx" ON "ProjectPhaseTask"("projectId");

-- CreateIndex
CREATE INDEX "ProjectPhaseTask_parentId_idx" ON "ProjectPhaseTask"("parentId");

-- CreateIndex
CREATE INDEX "ProjectPhaseTask_status_idx" ON "ProjectPhaseTask"("status");

-- CreateIndex
CREATE INDEX "ProjectPhaseTask_dueDate_idx" ON "ProjectPhaseTask"("dueDate");

-- CreateIndex
CREATE INDEX "ProjectPhaseTask_deletedAt_idx" ON "ProjectPhaseTask"("deletedAt");

-- CreateIndex
CREATE INDEX "ProjectTaskAssignee_userId_idx" ON "ProjectTaskAssignee"("userId");

-- CreateIndex
CREATE INDEX "ProjectTaskChangeRequest_projectId_status_idx" ON "ProjectTaskChangeRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectTaskChangeRequest_taskId_idx" ON "ProjectTaskChangeRequest"("taskId");

-- CreateIndex
CREATE INDEX "ProjectTaskChangeRequest_requesterId_idx" ON "ProjectTaskChangeRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_idx" ON "ProjectDocument"("projectId");

-- CreateIndex
CREATE INDEX "ProjectDocument_deletedAt_idx" ON "ProjectDocument"("deletedAt");

-- CreateIndex
CREATE INDEX "ProjectDocumentVersion_status_idx" ON "ProjectDocumentVersion"("status");

-- CreateIndex
CREATE INDEX "ProjectDocumentVersion_uploadedById_idx" ON "ProjectDocumentVersion"("uploadedById");

-- CreateIndex
CREATE INDEX "ProjectDocumentVersion_createdAt_idx" ON "ProjectDocumentVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDocumentVersion_documentId_version_key" ON "ProjectDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "ProjectDocumentReview_versionId_idx" ON "ProjectDocumentReview"("versionId");

-- CreateIndex
CREATE INDEX "ProjectDocumentReview_reviewerId_idx" ON "ProjectDocumentReview"("reviewerId");

-- CreateIndex
CREATE INDEX "ProjectCompound_compoundId_idx" ON "ProjectCompound"("compoundId");

-- CreateIndex
CREATE INDEX "ProjectChangeLog_projectId_createdAt_idx" ON "ProjectChangeLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectChangeLog_entityType_entityId_idx" ON "ProjectChangeLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ProjectChangeLog_operatorId_idx" ON "ProjectChangeLog"("operatorId");

-- CreateIndex
CREATE INDEX "ProjectChangeLog_requestId_idx" ON "ProjectChangeLog"("requestId");
