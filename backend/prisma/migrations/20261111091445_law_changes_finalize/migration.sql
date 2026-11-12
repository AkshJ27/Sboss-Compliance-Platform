-- AlterTable
ALTER TABLE "ComplianceSchedule" ALTER COLUMN "dueMonthOffset" DROP DEFAULT,
ALTER COLUMN "frequency" DROP DEFAULT,
ALTER COLUMN "libraryVersion" DROP DEFAULT,
ALTER COLUMN "periodBasis" DROP DEFAULT;
