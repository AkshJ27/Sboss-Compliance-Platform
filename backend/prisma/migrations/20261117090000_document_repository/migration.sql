-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "recordId" TEXT;

-- CreateTable
CREATE TABLE "DocCategory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "parentId" TEXT,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "verticalId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "subCategoryId" TEXT,
    "subSubCategoryId" TEXT,
    "name" TEXT NOT NULL,
    "docNumber" TEXT,
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'PROTECTED',
    "storedAt" TEXT,
    "ownerId" TEXT NOT NULL,
    "managerId" TEXT,
    "reviewDate" DATE,
    "expiryDate" DATE,
    "alertDays" INTEGER,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRecordUser" (
    "recordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DocumentRecordUser_pkey" PRIMARY KEY ("recordId","userId")
);

-- CreateIndex
CREATE INDEX "Document_recordId_idx" ON "Document"("recordId");

-- CreateIndex
CREATE INDEX "DocCategory_orgId_level_idx" ON "DocCategory"("orgId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "DocCategory_orgId_parentId_name_key" ON "DocCategory"("orgId", "parentId", "name");

-- CreateIndex
CREATE INDEX "DocumentRecord_orgId_createdAt_idx" ON "DocumentRecord"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentRecord_orgId_expiryDate_idx" ON "DocumentRecord"("orgId", "expiryDate");

-- CreateIndex
CREATE INDEX "DocumentRecord_orgId_ownerId_idx" ON "DocumentRecord"("orgId", "ownerId");

-- CreateIndex
CREATE INDEX "DocumentRecord_categoryId_idx" ON "DocumentRecord"("categoryId");

-- CreateIndex
CREATE INDEX "DocumentRecordUser_userId_idx" ON "DocumentRecordUser"("userId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "DocumentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocCategory" ADD CONSTRAINT "DocCategory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocCategory" ADD CONSTRAINT "DocCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DocCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "DocCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_subSubCategoryId_fkey" FOREIGN KEY ("subSubCategoryId") REFERENCES "DocCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecordUser" ADD CONSTRAINT "DocumentRecordUser_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "DocumentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRecordUser" ADD CONSTRAINT "DocumentRecordUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;