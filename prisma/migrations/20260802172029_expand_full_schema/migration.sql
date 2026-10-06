/*
  Warnings:

  - You are about to alter the column `minStock` on the `Reagent` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.
  - You are about to alter the column `stockQuantity` on the `Reagent` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.
  - You are about to alter the column `quantity` on the `ReagentLog` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.
  - You are about to alter the column `quantity` on the `Requisition` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.

*/
-- AlterTable
ALTER TABLE "Device" ADD COLUMN "scrappedAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "scrappedReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerified" DATETIME;

-- CreateTable
CREATE TABLE "ApiCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labId" TEXT NOT NULL,
    "userId" TEXT,
    "service" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "baseUrl" TEXT,
    "model" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiCredential_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT,
    "beforeData" TEXT,
    "afterData" TEXT,
    "note" TEXT,
    "labId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Qualification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "validMonths" INTEGER NOT NULL DEFAULT 36,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserQualification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expireAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserQualification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserQualification_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "Qualification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "purpose" TEXT,
    "fundInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeviceReservation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DeviceReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DeviceReservation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceQualification" (
    "deviceId" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,

    PRIMARY KEY ("deviceId", "qualificationId"),
    CONSTRAINT "DeviceQualification_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeviceQualification_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "Qualification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReagentQualification" (
    "reagentId" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,

    PRIMARY KEY ("reagentId", "qualificationId"),
    CONSTRAINT "ReagentQualification_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReagentQualification_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "Qualification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InspectionAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "assignerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "submittedAt" DATETIME,
    "submittedData" TEXT,
    "photoUrls" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InspectionAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InspectionAssignment_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "scheduledAt" DATETIME,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringPattern" TEXT NOT NULL DEFAULT 'NONE',
    "recurringTime" TEXT,
    "recurringDayOfWeek" INTEGER,
    "recurringDayOfMonth" INTEGER,
    "llmOptimized" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSpawnedAt" DATETIME,
    CONSTRAINT "Announcement_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Todo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "assignerId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "relatedId" TEXT,
    "completedById" TEXT,
    "completedAt" DATETIME,
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Todo_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Todo_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Todo_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
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

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" TEXT,
    "toolCallId" TEXT,
    "toolName" TEXT,
    "feedback" TEXT,
    "feedbackNote" TEXT,
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "citations" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "assistantUserId" TEXT,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_assistantUserId_fkey" FOREIGN KEY ("assistantUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JoinRequest_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JoinRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntityMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT,
    "attributes" TEXT,
    "mentionCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntityMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntityMemory_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "staticProfile" TEXT NOT NULL,
    "dynamicImplicit" TEXT NOT NULL DEFAULT '{}',
    "dynamicExplicit" TEXT NOT NULL DEFAULT '{}',
    "llmSummary" TEXT,
    "llmSummaryGeneratedAt" DATETIME,
    "userCorrection" TEXT,
    "userCorrectionUpdatedAt" DATETIME,
    "visibleToUser" BOOLEAN NOT NULL DEFAULT true,
    "visibleToAdmin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserProfile_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserActionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" TEXT,
    "sessionId" TEXT,
    "riskFlag" BOOLEAN NOT NULL DEFAULT false,
    "riskNote" TEXT,
    "expireAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserActionLog_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Compound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commonName" TEXT,
    "casNumber" TEXT,
    "smiles" TEXT,
    "molecularFormula" TEXT,
    "molecularWeight" REAL,
    "physicochemical" TEXT,
    "safetyInfo" TEXT,
    "synthesisNote" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SYNTHESIZED',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reagentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Compound_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Compound_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Compound_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SynthesisBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "compoundId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "synthesizedAt" DATETIME NOT NULL,
    "procedure" TEXT NOT NULL,
    "reactionConditions" TEXT,
    "reactants" TEXT,
    "productMass" REAL,
    "yieldPercent" REAL,
    "purityPercent" REAL,
    "characterizationNote" TEXT,
    "operatorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SynthesisBatch_compoundId_fkey" FOREIGN KEY ("compoundId") REFERENCES "Compound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SynthesisBatch_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SynthesisBatch_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BioAssay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "compoundId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "batchId" TEXT,
    "assayType" TEXT NOT NULL,
    "target" TEXT,
    "result" TEXT NOT NULL,
    "resultSummary" TEXT,
    "conditions" TEXT,
    "conclusion" TEXT,
    "note" TEXT,
    "testedById" TEXT NOT NULL,
    "testedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BioAssay_compoundId_fkey" FOREIGN KEY ("compoundId") REFERENCES "Compound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BioAssay_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BioAssay_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SynthesisBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BioAssay_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompoundUsageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "compoundId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "usageType" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "purpose" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "usedAt" DATETIME NOT NULL,
    "usedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompoundUsageLog_compoundId_fkey" FOREIGN KEY ("compoundId") REFERENCES "Compound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompoundUsageLog_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompoundUsageLog_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompoundDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "compoundId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "batchId" TEXT,
    "docType" TEXT NOT NULL,
    "docSubtype" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "note" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompoundDocument_compoundId_fkey" FOREIGN KEY ("compoundId") REFERENCES "Compound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompoundDocument_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompoundDocument_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SynthesisBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CompoundDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "recognitionResult" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "labId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Document_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("createdAt", "fileName", "fileUrl", "id", "recognitionResult", "status", "type", "uploadedById") SELECT "createdAt", "fileName", "fileUrl", "id", "recognitionResult", "status", "type", "uploadedById" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");
CREATE INDEX "Document_labId_idx" ON "Document"("labId");
CREATE INDEX "Document_type_idx" ON "Document"("type");
CREATE INDEX "Document_status_idx" ON "Document"("status");
CREATE TABLE "new_Lab" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT,
    "workStartTime" TEXT,
    "workEndTime" TEXT,
    "joinCode" TEXT,
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lab_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Lab" ("createdAt", "description", "id", "location", "name", "updatedAt") SELECT "createdAt", "description", "id", "location", "name", "updatedAt" FROM "Lab";
DROP TABLE "Lab";
ALTER TABLE "new_Lab" RENAME TO "Lab";
CREATE UNIQUE INDEX "Lab_joinCode_key" ON "Lab"("joinCode");
CREATE INDEX "Lab_name_idx" ON "Lab"("name");
CREATE TABLE "new_Reagent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "casNumber" TEXT,
    "specification" TEXT,
    "brand" TEXT,
    "dangerCategory" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "isHazardous" BOOLEAN NOT NULL DEFAULT false,
    "isControlled" BOOLEAN NOT NULL DEFAULT false,
    "storageLocation" TEXT,
    "stockQuantity" REAL NOT NULL DEFAULT 0,
    "totalStockedBottles" REAL NOT NULL DEFAULT 0,
    "minStock" REAL NOT NULL DEFAULT 0,
    "unit" TEXT,
    "purity" TEXT,
    "capacityPerUnit" REAL,
    "capacityUnit" TEXT,
    "density" REAL,
    "batchNumber" TEXT,
    "expiryDate" DATETIME,
    "labId" TEXT NOT NULL,
    "stockInDate" DATETIME,
    "stockInOperatorId" TEXT,
    "structureImgUrl" TEXT,
    "msdsUrl" TEXT,
    "msdsFileName" TEXT,
    "sopUrl" TEXT,
    "sopFileName" TEXT,
    "molecularFormula" TEXT,
    "molecularWeight" TEXT,
    "iupacName" TEXT,
    "smiles" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reagent_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reagent_stockInOperatorId_fkey" FOREIGN KEY ("stockInOperatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Reagent" ("batchNumber", "brand", "casNumber", "createdAt", "dangerCategory", "expiryDate", "id", "isHazardous", "labId", "minStock", "name", "riskLevel", "specification", "stockQuantity", "storageLocation", "unit", "updatedAt") SELECT "batchNumber", "brand", "casNumber", "createdAt", "dangerCategory", "expiryDate", "id", "isHazardous", "labId", "minStock", "name", "riskLevel", "specification", "stockQuantity", "storageLocation", "unit", "updatedAt" FROM "Reagent";
DROP TABLE "Reagent";
ALTER TABLE "new_Reagent" RENAME TO "Reagent";
CREATE INDEX "Reagent_labId_idx" ON "Reagent"("labId");
CREATE INDEX "Reagent_casNumber_idx" ON "Reagent"("casNumber");
CREATE INDEX "Reagent_riskLevel_idx" ON "Reagent"("riskLevel");
CREATE INDEX "Reagent_expiryDate_idx" ON "Reagent"("expiryDate");
CREATE INDEX "Reagent_isControlled_idx" ON "Reagent"("isControlled");
CREATE INDEX "Reagent_stockInOperatorId_idx" ON "Reagent"("stockInOperatorId");
CREATE TABLE "new_ReagentLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reagentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "operatorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReagentLog_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReagentLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ReagentLog" ("action", "createdAt", "id", "note", "operatorId", "quantity", "reagentId") SELECT "action", "createdAt", "id", "note", "operatorId", "quantity", "reagentId" FROM "ReagentLog";
DROP TABLE "ReagentLog";
ALTER TABLE "new_ReagentLog" RENAME TO "ReagentLog";
CREATE INDEX "ReagentLog_reagentId_idx" ON "ReagentLog"("reagentId");
CREATE INDEX "ReagentLog_operatorId_idx" ON "ReagentLog"("operatorId");
CREATE INDEX "ReagentLog_action_idx" ON "ReagentLog"("action");
CREATE TABLE "new_Requisition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reagentId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "requestedQuantity" REAL,
    "requestedUnit" TEXT,
    "conversionNote" TEXT,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewResult" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "labId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'APPLY',
    "usageTime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Requisition_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requisition_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requisition_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Requisition_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Requisition" ("applicantId", "createdAt", "id", "purpose", "quantity", "reagentId", "reviewResult", "reviewedAt", "reviewedById", "status") SELECT "applicantId", "createdAt", "id", "purpose", "quantity", "reagentId", "reviewResult", "reviewedAt", "reviewedById", "status" FROM "Requisition";
DROP TABLE "Requisition";
ALTER TABLE "new_Requisition" RENAME TO "Requisition";
CREATE INDEX "Requisition_reagentId_idx" ON "Requisition"("reagentId");
CREATE INDEX "Requisition_applicantId_idx" ON "Requisition"("applicantId");
CREATE INDEX "Requisition_reviewedById_idx" ON "Requisition"("reviewedById");
CREATE INDEX "Requisition_labId_idx" ON "Requisition"("labId");
CREATE INDEX "Requisition_status_idx" ON "Requisition"("status");
CREATE INDEX "Requisition_mode_idx" ON "Requisition"("mode");
CREATE TABLE "new_RiskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reagentId" TEXT,
    "deviceId" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" DATETIME,
    "resolvedById" TEXT,
    "labId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskEvent_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RiskEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RiskEvent_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RiskEvent_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RiskEvent" ("createdAt", "description", "deviceId", "id", "isResolved", "level", "reagentId", "resolvedAt", "resolvedById", "type") SELECT "createdAt", "description", "deviceId", "id", "isResolved", "level", "reagentId", "resolvedAt", "resolvedById", "type" FROM "RiskEvent";
DROP TABLE "RiskEvent";
ALTER TABLE "new_RiskEvent" RENAME TO "RiskEvent";
CREATE INDEX "RiskEvent_reagentId_idx" ON "RiskEvent"("reagentId");
CREATE INDEX "RiskEvent_deviceId_idx" ON "RiskEvent"("deviceId");
CREATE INDEX "RiskEvent_labId_idx" ON "RiskEvent"("labId");
CREATE INDEX "RiskEvent_type_idx" ON "RiskEvent"("type");
CREATE INDEX "RiskEvent_level_idx" ON "RiskEvent"("level");
CREATE INDEX "RiskEvent_isResolved_idx" ON "RiskEvent"("isResolved");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ApiCredential_labId_userId_service_idx" ON "ApiCredential"("labId", "userId", "service");

-- CreateIndex
CREATE INDEX "AuditLog_operatorId_idx" ON "AuditLog"("operatorId");

-- CreateIndex
CREATE INDEX "AuditLog_labId_idx" ON "AuditLog"("labId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_idx" ON "AuditLog"("targetType");

-- CreateIndex
CREATE INDEX "AuditLog_targetId_idx" ON "AuditLog"("targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Qualification_name_key" ON "Qualification"("name");

-- CreateIndex
CREATE INDEX "Qualification_name_idx" ON "Qualification"("name");

-- CreateIndex
CREATE INDEX "UserQualification_userId_idx" ON "UserQualification"("userId");

-- CreateIndex
CREATE INDEX "UserQualification_qualificationId_idx" ON "UserQualification"("qualificationId");

-- CreateIndex
CREATE INDEX "UserQualification_status_idx" ON "UserQualification"("status");

-- CreateIndex
CREATE INDEX "UserQualification_expireAt_idx" ON "UserQualification"("expireAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserQualification_userId_qualificationId_key" ON "UserQualification"("userId", "qualificationId");

-- CreateIndex
CREATE INDEX "DeviceReservation_deviceId_idx" ON "DeviceReservation"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceReservation_userId_idx" ON "DeviceReservation"("userId");

-- CreateIndex
CREATE INDEX "DeviceReservation_status_idx" ON "DeviceReservation"("status");

-- CreateIndex
CREATE INDEX "DeviceReservation_startTime_idx" ON "DeviceReservation"("startTime");

-- CreateIndex
CREATE INDEX "DeviceReservation_endTime_idx" ON "DeviceReservation"("endTime");

-- CreateIndex
CREATE INDEX "InspectionAssignment_labId_idx" ON "InspectionAssignment"("labId");

-- CreateIndex
CREATE INDEX "InspectionAssignment_assigneeId_idx" ON "InspectionAssignment"("assigneeId");

-- CreateIndex
CREATE INDEX "InspectionAssignment_status_idx" ON "InspectionAssignment"("status");

-- CreateIndex
CREATE INDEX "InspectionAssignment_dueDate_idx" ON "InspectionAssignment"("dueDate");

-- CreateIndex
CREATE INDEX "Announcement_labId_idx" ON "Announcement"("labId");

-- CreateIndex
CREATE INDEX "Announcement_status_idx" ON "Announcement"("status");

-- CreateIndex
CREATE INDEX "Announcement_scheduledAt_idx" ON "Announcement"("scheduledAt");

-- CreateIndex
CREATE INDEX "Announcement_createdById_idx" ON "Announcement"("createdById");

-- CreateIndex
CREATE INDEX "AnnouncementRead_announcementId_idx" ON "AnnouncementRead"("announcementId");

-- CreateIndex
CREATE INDEX "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_userId_key" ON "AnnouncementRead"("announcementId", "userId");

-- CreateIndex
CREATE INDEX "Todo_labId_idx" ON "Todo"("labId");

-- CreateIndex
CREATE INDEX "Todo_assigneeId_idx" ON "Todo"("assigneeId");

-- CreateIndex
CREATE INDEX "Todo_assignerId_idx" ON "Todo"("assignerId");

-- CreateIndex
CREATE INDEX "Todo_type_idx" ON "Todo"("type");

-- CreateIndex
CREATE INDEX "Todo_status_idx" ON "Todo"("status");

-- CreateIndex
CREATE INDEX "Todo_relatedId_idx" ON "Todo"("relatedId");

-- CreateIndex
CREATE INDEX "ChatSession_userId_idx" ON "ChatSession"("userId");

-- CreateIndex
CREATE INDEX "ChatSession_labId_idx" ON "ChatSession"("labId");

-- CreateIndex
CREATE INDEX "ChatSession_lastActiveAt_idx" ON "ChatSession"("lastActiveAt");

-- CreateIndex
CREATE INDEX "ChatSession_deletedAt_idx" ON "ChatSession"("deletedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_idx" ON "ChatMessage"("userId");

-- CreateIndex
CREATE INDEX "ChatMessage_assistantUserId_idx" ON "ChatMessage"("assistantUserId");

-- CreateIndex
CREATE INDEX "ChatMessage_role_idx" ON "ChatMessage"("role");

-- CreateIndex
CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_feedback_idx" ON "ChatMessage"("feedback");

-- CreateIndex
CREATE INDEX "Notification_recipientId_idx" ON "Notification"("recipientId");

-- CreateIndex
CREATE INDEX "Notification_labId_idx" ON "Notification"("labId");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_priority_idx" ON "Notification"("priority");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "JoinRequest_userId_idx" ON "JoinRequest"("userId");

-- CreateIndex
CREATE INDEX "JoinRequest_labId_idx" ON "JoinRequest"("labId");

-- CreateIndex
CREATE INDEX "JoinRequest_status_idx" ON "JoinRequest"("status");

-- CreateIndex
CREATE INDEX "JoinRequest_createdAt_idx" ON "JoinRequest"("createdAt");

-- CreateIndex
CREATE INDEX "EntityMemory_labId_idx" ON "EntityMemory"("labId");

-- CreateIndex
CREATE INDEX "EntityMemory_entityType_idx" ON "EntityMemory"("entityType");

-- CreateIndex
CREATE INDEX "EntityMemory_lastSeenAt_idx" ON "EntityMemory"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntityMemory_userId_entityType_name_key" ON "EntityMemory"("userId", "entityType", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "UserProfile_labId_idx" ON "UserProfile"("labId");

-- CreateIndex
CREATE INDEX "UserProfile_visibleToUser_idx" ON "UserProfile"("visibleToUser");

-- CreateIndex
CREATE INDEX "UserProfile_visibleToAdmin_idx" ON "UserProfile"("visibleToAdmin");

-- CreateIndex
CREATE INDEX "UserActionLog_userId_idx" ON "UserActionLog"("userId");

-- CreateIndex
CREATE INDEX "UserActionLog_labId_idx" ON "UserActionLog"("labId");

-- CreateIndex
CREATE INDEX "UserActionLog_action_idx" ON "UserActionLog"("action");

-- CreateIndex
CREATE INDEX "UserActionLog_entityType_entityId_idx" ON "UserActionLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "UserActionLog_riskFlag_idx" ON "UserActionLog"("riskFlag");

-- CreateIndex
CREATE INDEX "UserActionLog_expireAt_idx" ON "UserActionLog"("expireAt");

-- CreateIndex
CREATE INDEX "UserActionLog_createdAt_idx" ON "UserActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "Compound_labId_idx" ON "Compound"("labId");

-- CreateIndex
CREATE INDEX "Compound_name_idx" ON "Compound"("name");

-- CreateIndex
CREATE INDEX "Compound_casNumber_idx" ON "Compound"("casNumber");

-- CreateIndex
CREATE INDEX "Compound_smiles_idx" ON "Compound"("smiles");

-- CreateIndex
CREATE INDEX "Compound_status_idx" ON "Compound"("status");

-- CreateIndex
CREATE INDEX "Compound_createdById_idx" ON "Compound"("createdById");

-- CreateIndex
CREATE INDEX "Compound_reagentId_idx" ON "Compound"("reagentId");

-- CreateIndex
CREATE INDEX "SynthesisBatch_compoundId_idx" ON "SynthesisBatch"("compoundId");

-- CreateIndex
CREATE INDEX "SynthesisBatch_labId_idx" ON "SynthesisBatch"("labId");

-- CreateIndex
CREATE INDEX "SynthesisBatch_batchNumber_idx" ON "SynthesisBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "SynthesisBatch_synthesizedAt_idx" ON "SynthesisBatch"("synthesizedAt");

-- CreateIndex
CREATE INDEX "SynthesisBatch_operatorId_idx" ON "SynthesisBatch"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisBatch_compoundId_batchNumber_key" ON "SynthesisBatch"("compoundId", "batchNumber");

-- CreateIndex
CREATE INDEX "BioAssay_compoundId_idx" ON "BioAssay"("compoundId");

-- CreateIndex
CREATE INDEX "BioAssay_labId_idx" ON "BioAssay"("labId");

-- CreateIndex
CREATE INDEX "BioAssay_batchId_idx" ON "BioAssay"("batchId");

-- CreateIndex
CREATE INDEX "BioAssay_assayType_idx" ON "BioAssay"("assayType");

-- CreateIndex
CREATE INDEX "BioAssay_target_idx" ON "BioAssay"("target");

-- CreateIndex
CREATE INDEX "BioAssay_testedById_idx" ON "BioAssay"("testedById");

-- CreateIndex
CREATE INDEX "BioAssay_testedAt_idx" ON "BioAssay"("testedAt");

-- CreateIndex
CREATE INDEX "CompoundUsageLog_compoundId_idx" ON "CompoundUsageLog"("compoundId");

-- CreateIndex
CREATE INDEX "CompoundUsageLog_labId_idx" ON "CompoundUsageLog"("labId");

-- CreateIndex
CREATE INDEX "CompoundUsageLog_usageType_idx" ON "CompoundUsageLog"("usageType");

-- CreateIndex
CREATE INDEX "CompoundUsageLog_usedById_idx" ON "CompoundUsageLog"("usedById");

-- CreateIndex
CREATE INDEX "CompoundUsageLog_usedAt_idx" ON "CompoundUsageLog"("usedAt");

-- CreateIndex
CREATE INDEX "CompoundUsageLog_relatedType_relatedId_idx" ON "CompoundUsageLog"("relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "CompoundDocument_compoundId_idx" ON "CompoundDocument"("compoundId");

-- CreateIndex
CREATE INDEX "CompoundDocument_labId_idx" ON "CompoundDocument"("labId");

-- CreateIndex
CREATE INDEX "CompoundDocument_batchId_idx" ON "CompoundDocument"("batchId");

-- CreateIndex
CREATE INDEX "CompoundDocument_docType_idx" ON "CompoundDocument"("docType");

-- CreateIndex
CREATE INDEX "CompoundDocument_uploadedById_idx" ON "CompoundDocument"("uploadedById");

-- CreateIndex
CREATE INDEX "CompoundDocument_createdAt_idx" ON "CompoundDocument"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
