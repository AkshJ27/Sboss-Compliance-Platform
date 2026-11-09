-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('DUE', 'SUBMITTED', 'MANAGER_APPROVED', 'CLOSED', 'RETURNED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "ComplianceSchedule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "complianceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "departmentId" TEXT,
    "verticalId" TEXT,
    "ownerId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "approverId" TEXT,
    "startDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceInstance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "complianceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "departmentId" TEXT,
    "verticalId" TEXT,
    "ownerId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "approverId" TEXT,
    "requiresApprover" BOOLEAN NOT NULL DEFAULT false,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "InstanceStatus" NOT NULL DEFAULT 'DUE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceSchedule_orgId_isActive_idx" ON "ComplianceSchedule"("orgId", "isActive");

-- CreateIndex
CREATE INDEX "ComplianceSchedule_orgId_entityId_idx" ON "ComplianceSchedule"("orgId", "entityId");

-- CreateIndex
CREATE INDEX "ComplianceSchedule_ownerId_idx" ON "ComplianceSchedule"("ownerId");

-- CreateIndex
CREATE INDEX "ComplianceSchedule_managerId_idx" ON "ComplianceSchedule"("managerId");

-- CreateIndex
CREATE INDEX "ComplianceSchedule_complianceId_idx" ON "ComplianceSchedule"("complianceId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceSchedule_locationId_complianceId_key" ON "ComplianceSchedule"("locationId", "complianceId");

-- CreateIndex
CREATE INDEX "ComplianceInstance_orgId_dueDate_idx" ON "ComplianceInstance"("orgId", "dueDate");

-- CreateIndex
CREATE INDEX "ComplianceInstance_orgId_status_dueDate_idx" ON "ComplianceInstance"("orgId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ComplianceInstance_orgId_entityId_locationId_idx" ON "ComplianceInstance"("orgId", "entityId", "locationId");

-- CreateIndex
CREATE INDEX "ComplianceInstance_ownerId_status_idx" ON "ComplianceInstance"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ComplianceInstance_managerId_status_idx" ON "ComplianceInstance"("managerId", "status");

-- CreateIndex
CREATE INDEX "ComplianceInstance_complianceId_idx" ON "ComplianceInstance"("complianceId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceInstance_scheduleId_periodStart_key" ON "ComplianceInstance"("scheduleId", "periodStart");

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_complianceId_fkey" FOREIGN KEY ("complianceId") REFERENCES "Compliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSchedule" ADD CONSTRAINT "ComplianceSchedule_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ComplianceSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_complianceId_fkey" FOREIGN KEY ("complianceId") REFERENCES "Compliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
