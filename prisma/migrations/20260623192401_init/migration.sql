-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "labId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lab" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Reagent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "casNumber" TEXT,
    "specification" TEXT,
    "brand" TEXT,
    "dangerCategory" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "isHazardous" BOOLEAN NOT NULL DEFAULT false,
    "storageLocation" TEXT,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "batchNumber" TEXT,
    "expiryDate" DATETIME,
    "labId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reagent_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReagentLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reagentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "operatorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReagentLog_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReagentLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "recognitionResult" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "serialNumber" TEXT,
    "location" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "labId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Device_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NORMAL',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceUsage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DeviceUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Requisition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reagentId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewResult" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Requisition_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requisition_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requisition_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reagentId" TEXT,
    "deviceId" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" DATETIME,
    "resolvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskEvent_reagentId_fkey" FOREIGN KEY ("reagentId") REFERENCES "Reagent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RiskEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RiskEvent_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "result" JSONB,
    "findings" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Inspection_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Inspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_labId_idx" ON "User"("labId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Lab_name_idx" ON "Lab"("name");

-- CreateIndex
CREATE INDEX "Reagent_labId_idx" ON "Reagent"("labId");

-- CreateIndex
CREATE INDEX "Reagent_casNumber_idx" ON "Reagent"("casNumber");

-- CreateIndex
CREATE INDEX "Reagent_riskLevel_idx" ON "Reagent"("riskLevel");

-- CreateIndex
CREATE INDEX "Reagent_expiryDate_idx" ON "Reagent"("expiryDate");

-- CreateIndex
CREATE INDEX "ReagentLog_reagentId_idx" ON "ReagentLog"("reagentId");

-- CreateIndex
CREATE INDEX "ReagentLog_operatorId_idx" ON "ReagentLog"("operatorId");

-- CreateIndex
CREATE INDEX "ReagentLog_action_idx" ON "ReagentLog"("action");

-- CreateIndex
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");

-- CreateIndex
CREATE INDEX "Document_type_idx" ON "Document"("type");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "Device_labId_idx" ON "Device"("labId");

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");

-- CreateIndex
CREATE INDEX "Device_riskLevel_idx" ON "Device"("riskLevel");

-- CreateIndex
CREATE INDEX "DeviceUsage_deviceId_idx" ON "DeviceUsage"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceUsage_userId_idx" ON "DeviceUsage"("userId");

-- CreateIndex
CREATE INDEX "DeviceUsage_status_idx" ON "DeviceUsage"("status");

-- CreateIndex
CREATE INDEX "Requisition_reagentId_idx" ON "Requisition"("reagentId");

-- CreateIndex
CREATE INDEX "Requisition_applicantId_idx" ON "Requisition"("applicantId");

-- CreateIndex
CREATE INDEX "Requisition_reviewedById_idx" ON "Requisition"("reviewedById");

-- CreateIndex
CREATE INDEX "Requisition_status_idx" ON "Requisition"("status");

-- CreateIndex
CREATE INDEX "RiskEvent_reagentId_idx" ON "RiskEvent"("reagentId");

-- CreateIndex
CREATE INDEX "RiskEvent_deviceId_idx" ON "RiskEvent"("deviceId");

-- CreateIndex
CREATE INDEX "RiskEvent_type_idx" ON "RiskEvent"("type");

-- CreateIndex
CREATE INDEX "RiskEvent_level_idx" ON "RiskEvent"("level");

-- CreateIndex
CREATE INDEX "RiskEvent_isResolved_idx" ON "RiskEvent"("isResolved");

-- CreateIndex
CREATE INDEX "Inspection_labId_idx" ON "Inspection"("labId");

-- CreateIndex
CREATE INDEX "Inspection_inspectorId_idx" ON "Inspection"("inspectorId");

-- CreateIndex
CREATE INDEX "Inspection_type_idx" ON "Inspection"("type");

-- CreateIndex
CREATE INDEX "Inspection_status_idx" ON "Inspection"("status");
