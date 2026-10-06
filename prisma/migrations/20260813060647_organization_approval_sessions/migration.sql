-- CreateTable
CREATE TABLE "College" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CollegeMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collegeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COLLEGE_MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollegeMembership_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollegeMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollegeMembership_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'LAB_MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabMembership_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabMembership_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegistrationApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationType" TEXT NOT NULL,
    "targetLabId" TEXT,
    "requestedLabRole" TEXT NOT NULL,
    "requestedLabName" TEXT,
    "requestedLocation" TEXT,
    "schoolName" TEXT,
    "collegeName" TEXT,
    "formSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewComment" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RegistrationApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RegistrationApplication_targetLabId_fkey" FOREIGN KEY ("targetLabId") REFERENCES "Lab" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RegistrationApplication_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "beforeData" TEXT,
    "afterData" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAuditLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lab" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "school" TEXT,
    "college" TEXT,
    "description" TEXT,
    "workStartTime" TEXT,
    "workEndTime" TEXT,
    "joinCode" TEXT,
    "ownerId" TEXT,
    "collegeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lab_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lab_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Lab" ("college", "createdAt", "description", "id", "joinCode", "location", "name", "ownerId", "school", "updatedAt", "workEndTime", "workStartTime") SELECT "college", "createdAt", "description", "id", "joinCode", "location", "name", "ownerId", "school", "updatedAt", "workEndTime", "workStartTime" FROM "Lab";
DROP TABLE "Lab";
ALTER TABLE "new_Lab" RENAME TO "Lab";
CREATE UNIQUE INDEX "Lab_joinCode_key" ON "Lab"("joinCode");
CREATE INDEX "Lab_name_idx" ON "Lab"("name");
CREATE INDEX "Lab_collegeId_idx" ON "Lab"("collegeId");
CREATE TABLE "new_Qualification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "labId" TEXT,
    "collegeId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'LAB',
    "description" TEXT,
    "validMonths" INTEGER NOT NULL DEFAULT 36,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Qualification" ("createdAt", "description", "id", "name", "updatedAt", "validMonths") SELECT "createdAt", "description", "id", "name", "updatedAt", "validMonths" FROM "Qualification";
DROP TABLE "Qualification";
ALTER TABLE "new_Qualification" RENAME TO "Qualification";
CREATE INDEX "Qualification_name_idx" ON "Qualification"("name");
CREATE INDEX "Qualification_labId_scope_idx" ON "Qualification"("labId", "scope");
CREATE UNIQUE INDEX "Qualification_labId_name_key" ON "Qualification"("labId", "name");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "platformRole" TEXT NOT NULL DEFAULT 'PLATFORM_USER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "labId" TEXT,
    "phoneEncrypted" TEXT,
    "institutionType" TEXT,
    "schoolName" TEXT,
    "collegeName" TEXT,
    "academicIdentity" TEXT,
    "companyName" TEXT,
    "companyIdentity" TEXT,
    "statusReason" TEXT,
    "statusChangedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "labId", "name", "password", "role", "updatedAt") SELECT "createdAt", "email", "emailVerified", "id", "labId", "name", "password", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_labId_idx" ON "User"("labId");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_status_idx" ON "User"("status");
CREATE INDEX "User_platformRole_idx" ON "User"("platformRole");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "College_code_key" ON "College"("code");

-- CreateIndex
CREATE INDEX "College_status_idx" ON "College"("status");

-- CreateIndex
CREATE UNIQUE INDEX "College_schoolName_name_key" ON "College"("schoolName", "name");

-- CreateIndex
CREATE INDEX "CollegeMembership_userId_status_idx" ON "CollegeMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "CollegeMembership_collegeId_role_status_idx" ON "CollegeMembership"("collegeId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CollegeMembership_collegeId_userId_key" ON "CollegeMembership"("collegeId", "userId");

-- CreateIndex
CREATE INDEX "LabMembership_userId_status_isPrimary_idx" ON "LabMembership"("userId", "status", "isPrimary");

-- CreateIndex
CREATE INDEX "LabMembership_labId_role_status_idx" ON "LabMembership"("labId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LabMembership_labId_userId_key" ON "LabMembership"("labId", "userId");

-- CreateIndex
CREATE INDEX "RegistrationApplication_status_submittedAt_idx" ON "RegistrationApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "RegistrationApplication_targetLabId_status_idx" ON "RegistrationApplication"("targetLabId", "status");

-- CreateIndex
CREATE INDEX "RegistrationApplication_userId_status_idx" ON "RegistrationApplication"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_operatorId_createdAt_idx" ON "PlatformAuditLog"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_targetType_targetId_idx" ON "PlatformAuditLog"("targetType", "targetId");

-- Backfill the new authorization source from the legacy single-lab fields.
-- Lab.ownerId is authoritative for LAB_OWNER; other legacy admins become LAB_ADMIN.
INSERT INTO "LabMembership" (
    "id", "labId", "userId", "role", "status", "isPrimary", "approvedAt", "createdAt", "updatedAt"
)
SELECT
    'lm_' || lower(hex(randomblob(12))),
    u."labId",
    u."id",
    CASE WHEN l."ownerId" = u."id" THEN 'LAB_OWNER'
         WHEN u."role" = 'ADMIN' THEN 'LAB_ADMIN'
         ELSE 'LAB_MEMBER' END,
    'ACTIVE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
JOIN "Lab" l ON l."id" = u."labId"
WHERE u."labId" IS NOT NULL;

-- Existing qualification templates remain available as explicitly platform-scoped templates.
UPDATE "Qualification" SET "scope" = 'PLATFORM' WHERE "labId" IS NULL;
