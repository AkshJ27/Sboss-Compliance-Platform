-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LEGAL_UPDATE';

-- CreateTable
CREATE TABLE "LegalUpdate" (
    "id" TEXT NOT NULL,
    "actId" TEXT NOT NULL,
    "ruleId" TEXT,
    "ministry" TEXT,
    "notificationDate" DATE NOT NULL,
    "effectiveDate" DATE,
    "publishedDate" DATE NOT NULL,
    "referenceNumber" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "complianceImpact" BOOLEAN NOT NULL DEFAULT false,
    "isChange" BOOLEAN NOT NULL DEFAULT false,
    "isAddition" BOOLEAN NOT NULL DEFAULT false,
    "isDeletion" BOOLEAN NOT NULL DEFAULT false,
    "isSchedule" BOOLEAN NOT NULL DEFAULT false,
    "impactedCompliance" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalUpdateFile" (
    "id" TEXT NOT NULL,
    "legalUpdateId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalUpdateFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActSubscription" (
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actId" TEXT NOT NULL,
    "emailAlerts" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActSubscription_pkey" PRIMARY KEY ("userId","actId")
);

-- CreateIndex
CREATE INDEX "LegalUpdate_actId_notificationDate_idx" ON "LegalUpdate"("actId", "notificationDate");

-- CreateIndex
CREATE INDEX "LegalUpdate_notificationDate_idx" ON "LegalUpdate"("notificationDate");

-- CreateIndex
CREATE INDEX "LegalUpdate_publishedDate_idx" ON "LegalUpdate"("publishedDate");

-- CreateIndex
CREATE UNIQUE INDEX "LegalUpdateFile_storageKey_key" ON "LegalUpdateFile"("storageKey");

-- CreateIndex
CREATE INDEX "LegalUpdateFile_legalUpdateId_idx" ON "LegalUpdateFile"("legalUpdateId");

-- CreateIndex
CREATE INDEX "ActSubscription_orgId_idx" ON "ActSubscription"("orgId");

-- CreateIndex
CREATE INDEX "ActSubscription_actId_idx" ON "ActSubscription"("actId");

-- AddForeignKey
ALTER TABLE "LegalUpdate" ADD CONSTRAINT "LegalUpdate_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalUpdate" ADD CONSTRAINT "LegalUpdate_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalUpdateFile" ADD CONSTRAINT "LegalUpdateFile_legalUpdateId_fkey" FOREIGN KEY ("legalUpdateId") REFERENCES "LegalUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActSubscription" ADD CONSTRAINT "ActSubscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActSubscription" ADD CONSTRAINT "ActSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActSubscription" ADD CONSTRAINT "ActSubscription_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE CASCADE ON UPDATE CASCADE;