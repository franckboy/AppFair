-- DropForeignKey
ALTER TABLE "LossCategory" DROP CONSTRAINT "LossCategory_riskScenarioId_fkey";

-- DropForeignKey
ALTER TABLE "Treatment" DROP CONSTRAINT "Treatment_riskScenarioId_fkey";

-- AddForeignKey
ALTER TABLE "LossCategory" ADD CONSTRAINT "LossCategory_riskScenarioId_fkey" FOREIGN KEY ("riskScenarioId") REFERENCES "RiskScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_riskScenarioId_fkey" FOREIGN KEY ("riskScenarioId") REFERENCES "RiskScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
