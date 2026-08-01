/**
 * Translates between Prisma's flat columns/related rows and the nested shape the
 * API and the FAIR engine use. Kept separate from riskScenarios.ts (HTTP routing)
 * so the shape of a "risk scenario" can change without touching route handlers,
 * and vice versa.
 */
import type { LossCategory, RiskScenario } from "../generated/prisma/client.js";
import { LOSS_CATEGORY_LABEL, type LossCategoryKey } from "../fair/lossCategories.js";
import { runSimulation } from "../fair/simulate.js";
import type { RiskScenarioInput } from "./riskScenarios.schema.js";

export type RiskScenarioWithCategories = RiskScenario & { lossCategories: LossCategory[] };

/** Maps the flat Prisma columns + related rows to the nested shape the API and the FAIR engine use. */
export function toDto(scenario: RiskScenarioWithCategories) {
  return {
    id: scenario.id,
    name: scenario.name,
    assetId: scenario.assetId,
    threatId: scenario.threatId,
    threatEventFrequency: { min: scenario.tefMin, mostLikely: scenario.tefMostLikely, max: scenario.tefMax },
    vulnerability: { min: scenario.vulnMin, mostLikely: scenario.vulnMostLikely, max: scenario.vulnMax },
    lossCategories: scenario.lossCategories.map((c) => ({
      key: c.key,
      label: LOSS_CATEGORY_LABEL[c.key as LossCategoryKey] ?? c.key,
      estimate: { min: c.min, mostLikely: c.mostLikely, max: c.max },
    })),
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
  };
}

export type RiskScenarioDto = ReturnType<typeof toDto>;

/** Only includes the scalar (non-loss-category) columns present in a partial update. */
export function scalarFields(input: Partial<RiskScenarioInput>) {
  const data: Record<string, string | number> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.assetId !== undefined) data.assetId = input.assetId;
  if (input.threatId !== undefined) data.threatId = input.threatId;
  if (input.threatEventFrequency) {
    data.tefMin = input.threatEventFrequency.min;
    data.tefMostLikely = input.threatEventFrequency.mostLikely;
    data.tefMax = input.threatEventFrequency.max;
  }
  if (input.vulnerability) {
    data.vulnMin = input.vulnerability.min;
    data.vulnMostLikely = input.vulnerability.mostLikely;
    data.vulnMax = input.vulnerability.max;
  }
  return data;
}

export function toEngineInput(dto: RiskScenarioDto) {
  return {
    threatEventFrequency: dto.threatEventFrequency,
    vulnerability: dto.vulnerability,
    lossMagnitudeCategories: dto.lossCategories.map((c) => ({ key: c.key, estimate: c.estimate })),
  };
}

/** Adds a freshly-simulated ALE to a scenario DTO — used only by the list/detail GETs, where UI shows a criticality badge next to the scenario, not by create/update. */
export function withAle(dto: RiskScenarioDto) {
  const { ale } = runSimulation(toEngineInput(dto));
  return { ...dto, ale };
}
