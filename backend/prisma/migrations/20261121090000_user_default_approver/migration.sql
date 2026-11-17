-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultApproverId" TEXT;

-- CreateIndex
CREATE INDEX "User_defaultApproverId_idx" ON "User"("defaultApproverId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultApproverId_fkey" FOREIGN KEY ("defaultApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;