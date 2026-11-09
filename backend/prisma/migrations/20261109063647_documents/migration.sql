-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('PUBLIC', 'PRIVATE', 'PROTECTED', 'RESTRICTED');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instanceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "docNumber" TEXT,
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'PROTECTED',
    "expiresAt" DATE,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_instanceId_idx" ON "Document"("instanceId");

-- CreateIndex
CREATE INDEX "Document_orgId_createdAt_idx" ON "Document"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_orgId_expiresAt_idx" ON "Document"("orgId", "expiresAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ComplianceInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
