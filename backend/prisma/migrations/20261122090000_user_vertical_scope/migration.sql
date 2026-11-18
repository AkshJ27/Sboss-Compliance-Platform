-- CreateTable
CREATE TABLE "UserVertical" (
    "userId" TEXT NOT NULL,
    "verticalId" TEXT NOT NULL,

    CONSTRAINT "UserVertical_pkey" PRIMARY KEY ("userId","verticalId")
);

-- CreateIndex
CREATE INDEX "UserVertical_verticalId_idx" ON "UserVertical"("verticalId");

-- AddForeignKey
ALTER TABLE "UserVertical" ADD CONSTRAINT "UserVertical_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVertical" ADD CONSTRAINT "UserVertical_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;