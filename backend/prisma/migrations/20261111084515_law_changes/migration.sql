-- CreateEnum
CREATE TYPE "AmendmentDecisionType" AS ENUM ('APPLIED', 'KEPT', 'ACKNOWLEDGED');

-- AlterEnum
ALTER TYPE "InstanceAction" ADD VALUE 'DUE_DATE_CHANGED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LAW_CHANGE';

-- AlterTable
ALTER TABLE "ComplianceSchedule" ADD COLUMN     "dueDay" INTEGER,
ADD COLUMN     "dueDaysAfterEvent" INTEGER,
ADD COLUMN     "dueMonthOffset" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "event" TEXT,
ADD COLUMN     "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "libraryVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "periodBasis" "PeriodBasis" NOT NULL DEFAULT 'FINANCIAL_YEAR';

-- CreateTable
CREATE TABLE "AmendmentDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "complianceId" TEXT NOT NULL,
    "decision" "AmendmentDecisionType" NOT NULL,
    "fromVersion" INTEGER NOT NULL,
    "toVersion" INTEGER NOT NULL,
    "changes" JSONB NOT NULL,
    "schedulesUpdated" INTEGER NOT NULL,
    "itemsMoved" INTEGER NOT NULL,
    "note" TEXT,
    "decidedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmendmentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmendmentDecision_orgId_createdAt_idx" ON "AmendmentDecision"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AmendmentDecision_orgId_complianceId_idx" ON "AmendmentDecision"("orgId", "complianceId");

-- AddForeignKey
ALTER TABLE "AmendmentDecision" ADD CONSTRAINT "AmendmentDecision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmendmentDecision" ADD CONSTRAINT "AmendmentDecision_complianceId_fkey" FOREIGN KEY ("complianceId") REFERENCES "Compliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmendmentDecision" ADD CONSTRAINT "AmendmentDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
