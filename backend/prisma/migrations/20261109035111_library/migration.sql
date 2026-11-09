-- CreateEnum
CREATE TYPE "Jurisdiction" AS ENUM ('CENTRAL', 'STATE');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'EVENT_BASED');

-- CreateEnum
CREATE TYPE "PeriodBasis" AS ENUM ('FINANCIAL_YEAR', 'CALENDAR_YEAR');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AttachmentRule" AS ENUM ('MANDATORY', 'OPTIONAL', 'NOT_REQUIRED');

-- CreateTable
CREATE TABLE "LawCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LawCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryAuthority" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatutoryAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceNature" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceNature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Act" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" "Jurisdiction" NOT NULL,
    "state" TEXT,
    "lawCategoryId" TEXT NOT NULL,
    "statutoryAuthorityId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Act_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "actId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compliance" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "actId" TEXT NOT NULL,
    "ruleId" TEXT,
    "natureId" TEXT,
    "typeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "form" TEXT,
    "reference" TEXT,
    "risk" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "impact" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "attachment" "AttachmentRule" NOT NULL DEFAULT 'OPTIONAL',
    "frequency" "Frequency" NOT NULL,
    "periodBasis" "PeriodBasis" NOT NULL DEFAULT 'FINANCIAL_YEAR',
    "dueDay" INTEGER,
    "dueMonthOffset" INTEGER NOT NULL DEFAULT 0,
    "event" TEXT,
    "dueDaysAfterEvent" INTEGER,
    "penalty" TEXT,
    "imprisonment" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Compliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRevision" (
    "id" TEXT NOT NULL,
    "complianceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changes" JSONB NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LawCategory_name_key" ON "LawCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryAuthority_name_key" ON "StatutoryAuthority"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceNature_name_key" ON "ComplianceNature"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceType_name_key" ON "ComplianceType"("name");

-- CreateIndex
CREATE INDEX "Act_lawCategoryId_idx" ON "Act"("lawCategoryId");

-- CreateIndex
CREATE INDEX "Act_state_idx" ON "Act"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Act_name_jurisdiction_state_key" ON "Act"("name", "jurisdiction", "state");

-- CreateIndex
CREATE INDEX "Rule_actId_idx" ON "Rule"("actId");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_actId_name_key" ON "Rule"("actId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Compliance_code_key" ON "Compliance"("code");

-- CreateIndex
CREATE INDEX "Compliance_actId_idx" ON "Compliance"("actId");

-- CreateIndex
CREATE INDEX "Compliance_ruleId_idx" ON "Compliance"("ruleId");

-- CreateIndex
CREATE INDEX "Compliance_frequency_idx" ON "Compliance"("frequency");

-- CreateIndex
CREATE INDEX "Compliance_risk_idx" ON "Compliance"("risk");

-- CreateIndex
CREATE INDEX "Compliance_isActive_idx" ON "Compliance"("isActive");

-- CreateIndex
CREATE INDEX "ComplianceRevision_complianceId_idx" ON "ComplianceRevision"("complianceId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRevision_complianceId_version_key" ON "ComplianceRevision"("complianceId", "version");

-- AddForeignKey
ALTER TABLE "Act" ADD CONSTRAINT "Act_lawCategoryId_fkey" FOREIGN KEY ("lawCategoryId") REFERENCES "LawCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Act" ADD CONSTRAINT "Act_statutoryAuthorityId_fkey" FOREIGN KEY ("statutoryAuthorityId") REFERENCES "StatutoryAuthority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compliance" ADD CONSTRAINT "Compliance_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compliance" ADD CONSTRAINT "Compliance_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compliance" ADD CONSTRAINT "Compliance_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "ComplianceNature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compliance" ADD CONSTRAINT "Compliance_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ComplianceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRevision" ADD CONSTRAINT "ComplianceRevision_complianceId_fkey" FOREIGN KEY ("complianceId") REFERENCES "Compliance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
