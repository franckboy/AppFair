/*
  Warnings:

  - You are about to drop the column `lmMax` on the `RiskScenario` table. All the data in the column will be lost.
  - You are about to drop the column `lmMin` on the `RiskScenario` table. All the data in the column will be lost.
  - You are about to drop the column `lmMostLikely` on the `RiskScenario` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "RiskScenario" DROP COLUMN "lmMax",
DROP COLUMN "lmMin",
DROP COLUMN "lmMostLikely";

-- CreateTable
CREATE TABLE "LossCategory" (
    "id" TEXT NOT NULL,
    "riskScenarioId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "mostLikely" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LossCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LossCategory_riskScenarioId_idx" ON "LossCategory"("riskScenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "LossCategory_riskScenarioId_key_key" ON "LossCategory"("riskScenarioId", "key");

-- AddForeignKey
ALTER TABLE "LossCategory" ADD CONSTRAINT "LossCategory_riskScenarioId_fkey" FOREIGN KEY ("riskScenarioId") REFERENCES "RiskScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
