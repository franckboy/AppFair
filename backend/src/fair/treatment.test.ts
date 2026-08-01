import { describe, expect, it } from "vitest";
import type { RiskScenarioInput } from "./simulate.js";
import { evaluateTreatment } from "./treatment.js";

function fixed(value: number) {
  return { min: value, mostLikely: value, max: value };
}

const scenario: RiskScenarioInput = {
  threatEventFrequency: fixed(10),
  vulnerability: fixed(0.5),
  lossMagnitude: fixed(1_000),
};

describe("evaluateTreatment", () => {
  it("ACCEPT leaves the scenario unchanged and reports no ROSI", () => {
    const result = evaluateTreatment(scenario, { strategy: "ACCEPT", annualCost: 0 }, { iterations: 5000, seed: 1 });
    expect(result.aleAfter).toBe(result.aleBefore);
    expect(result.riskReduction).toBe(0);
    expect(result.rosi).toBeNull();
  });

  it("AVOID eliminates the loss regardless of reductionPct", () => {
    const result = evaluateTreatment(scenario, { strategy: "AVOID", annualCost: 5000 }, { iterations: 5000, seed: 2 });
    expect(result.aleAfter).toBe(0);
    expect(result.riskReduction).toBeCloseTo(result.aleBefore);
  });

  it("MITIGATE at 100% vulnerability reduction drives ALE to ~0", () => {
    const result = evaluateTreatment(
      scenario,
      { strategy: "MITIGATE", annualCost: 1000, reductionPct: 100 },
      { iterations: 10_000, seed: 3 },
    );
    expect(result.aleAfter).toBeLessThan(result.aleBefore * 0.01);
  });

  it("TRANSFER at 100% coverage drives retained ALE to ~0", () => {
    const result = evaluateTreatment(
      scenario,
      { strategy: "TRANSFER", annualCost: 1000, reductionPct: 100 },
      { iterations: 10_000, seed: 4 },
    );
    expect(result.aleAfter).toBeLessThan(result.aleBefore * 0.01);
  });

  it("MITIGATE at 0% reduction matches the baseline (no-op control)", () => {
    const result = evaluateTreatment(
      scenario,
      { strategy: "MITIGATE", annualCost: 1000, reductionPct: 0 },
      { iterations: 5000, seed: 5 },
    );
    expect(result.aleAfter).toBe(result.aleBefore);
  });

  it("computes ROSI as (risk reduction - cost) / cost", () => {
    const result = evaluateTreatment(
      scenario,
      { strategy: "AVOID", annualCost: 2000 },
      { iterations: 5000, seed: 6 },
    );
    const expectedRosi = (result.aleBefore - 2000) / 2000;
    expect(result.rosi).toBeCloseTo(expectedRosi);
  });

  it("returns null ROSI when annualCost is 0 even for an effective treatment", () => {
    const result = evaluateTreatment(scenario, { strategy: "AVOID", annualCost: 0 }, { iterations: 5000, seed: 7 });
    expect(result.rosi).toBeNull();
  });
});
