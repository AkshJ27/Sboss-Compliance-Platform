-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_TRIGGERED';

-- AlterTable
ALTER TABLE "ComplianceInstance" ADD COLUMN     "triggerId" TEXT;

-- CreateTable
CREATE TABLE "EventTrigger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "EventTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventTrigger_orgId_createdAt_idx" ON "EventTrigger"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "EventTrigger_locationId_eventDate_idx" ON "EventTrigger"("locationId", "eventDate");

-- CreateIndex
CREATE INDEX "ComplianceInstance_triggerId_idx" ON "ComplianceInstance"("triggerId");

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "EventTrigger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTrigger" ADD CONSTRAINT "EventTrigger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTrigger" ADD CONSTRAINT "EventTrigger_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTrigger" ADD CONSTRAINT "EventTrigger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTrigger" ADD CONSTRAINT "EventTrigger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
