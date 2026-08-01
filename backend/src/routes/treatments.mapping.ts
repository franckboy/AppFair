/** Translates a Prisma Treatment row to the API shape — see riskScenarios.mapping.ts for the equivalent on scenarios. */
import type { Treatment } from "../generated/prisma/client.js";

export function toDto(treatment: Treatment) {
  return {
    id: treatment.id,
    riskScenarioId: treatment.riskScenarioId,
    strategy: treatment.strategy,
    name: treatment.name,
    annualCost: treatment.annualCost,
    reductionPct: treatment.reductionPct,
    createdAt: treatment.createdAt,
    updatedAt: treatment.updatedAt,
  };
}
