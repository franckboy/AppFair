-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "value" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Threat" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Threat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskScenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "threatId" TEXT NOT NULL,
    "tefMin" DOUBLE PRECISION NOT NULL,
    "tefMostLikely" DOUBLE PRECISION NOT NULL,
    "tefMax" DOUBLE PRECISION NOT NULL,
    "vulnMin" DOUBLE PRECISION NOT NULL,
    "vulnMostLikely" DOUBLE PRECISION NOT NULL,
    "vulnMax" DOUBLE PRECISION NOT NULL,
    "lmMin" DOUBLE PRECISION NOT NULL,
    "lmMostLikely" DOUBLE PRECISION NOT NULL,
    "lmMax" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskScenario_assetId_idx" ON "RiskScenario"("assetId");

-- CreateIndex
CREATE INDEX "RiskScenario_threatId_idx" ON "RiskScenario"("threatId");

-- AddForeignKey
ALTER TABLE "RiskScenario" ADD CONSTRAINT "RiskScenario_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskScenario" ADD CONSTRAINT "RiskScenario_threatId_fkey" FOREIGN KEY ("threatId") REFERENCES "Threat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
