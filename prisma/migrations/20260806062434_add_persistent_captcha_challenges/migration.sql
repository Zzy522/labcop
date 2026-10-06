-- AlterTable
ALTER TABLE "Lab" ADD COLUMN "college" TEXT;
ALTER TABLE "Lab" ADD COLUMN "school" TEXT;

-- CreateTable
CREATE TABLE "CaptchaChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "answerHash" TEXT NOT NULL,
    "svg" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CaptchaChallenge_expiresAt_idx" ON "CaptchaChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "CaptchaChallenge_consumedAt_idx" ON "CaptchaChallenge"("consumedAt");
