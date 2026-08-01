-- CreateEnum
CREATE TYPE "TreatmentStrategy" AS ENUM ('MITIGATE', 'TRANSFER', 'AVOID', 'ACCEPT');

-- CreateTable
CREATE TABLE "Treatment" (
    "id" TEXT NOT NULL,
    "riskScenarioId" TEXT NOT NULL,
    "strategy" "TreatmentStrategy" NOT NULL,
    "name" TEXT NOT NULL,
    "annualCost" DOUBLE PRECISION NOT NULL,
    "reductionPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Treatment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Treatment_riskScenarioId_idx" ON "Treatment"("riskScenarioId");

-- AddForeignKey
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_riskScenarioId_fkey" FOREIGN KEY ("riskScenarioId") REFERENCES "RiskScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
