-- AlterTable
ALTER TABLE "Act" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Compliance" ADD COLUMN     "alertManagerDays" INTEGER,
ADD COLUMN     "alertOwnerDays" INTEGER,
ADD COLUMN     "applicability" TEXT,
ADD COLUMN     "effectiveDate" DATE,
ADD COLUMN     "orgId" TEXT,
ADD COLUMN     "proofOfCompliance" TEXT;

-- CreateIndex
CREATE INDEX "Act_orgId_idx" ON "Act"("orgId");

-- CreateIndex
CREATE INDEX "Compliance_orgId_idx" ON "Compliance"("orgId");

-- AddForeignKey
ALTER TABLE "Act" ADD CONSTRAINT "Act_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compliance" ADD CONSTRAINT "Compliance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;