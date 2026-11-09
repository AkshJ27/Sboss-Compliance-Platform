-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('APPLICABLE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "InstanceAction" AS ENUM ('DRAFT_SAVED', 'SUBMITTED', 'MANAGER_APPROVED', 'APPROVED', 'RETURNED', 'REASSIGNED');

-- AlterTable
ALTER TABLE "ComplianceInstance" ADD COLUMN     "actualImprisonment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "amountPaid" DECIMAL(12,2),
ADD COLUMN     "challanNo" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "doneDate" DATE,
ADD COLUMN     "isWip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "managerActionAt" TIMESTAMP(3),
ADD COLUMN     "managerActionById" TEXT,
ADD COLUMN     "payableAmount" DECIMAL(12,2),
ADD COLUMN     "penaltyPaid" DECIMAL(12,2),
ADD COLUMN     "refNo" TEXT,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "returnRemarks" TEXT,
ADD COLUMN     "submissionType" "SubmissionType",
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT;

-- CreateTable
CREATE TABLE "InstanceEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "InstanceAction" NOT NULL,
    "fromStatus" "InstanceStatus",
    "toStatus" "InstanceStatus",
    "remarks" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstanceEvent_instanceId_createdAt_idx" ON "InstanceEvent"("instanceId", "createdAt");

-- CreateIndex
CREATE INDEX "InstanceEvent_orgId_createdAt_idx" ON "InstanceEvent"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "InstanceEvent" ADD CONSTRAINT "InstanceEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceEvent" ADD CONSTRAINT "InstanceEvent_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ComplianceInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceEvent" ADD CONSTRAINT "InstanceEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
