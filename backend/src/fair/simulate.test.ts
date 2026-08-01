import { describe, expect, it } from "vitest";
import { runSimulation, type RiskScenarioInput } from "./simulate.js";

function fixed(value: number) {
  return { min: value, mostLikely: value, max: value };
}

describe("runSimulation", () => {
  it("is deterministic for a given seed", () => {
    const input: RiskScenarioInput = {
      threatEventFrequency: { min: 1, mostLikely: 4, max: 12 },
      vulnerability: { min: 0.1, mostLikely: 0.3, max: 0.6 },
      lossMagnitude: { min: 5_000, mostLikely: 20_000, max: 100_000 },
    };

    const a = runSimulation(input, { iterations: 2000, seed: 1 });
    const b = runSimulation(input, { iterations: 2000, seed: 1 });
    expect(a).toEqual(b);
  });

  it("matches the analytical expectation when every input is a fixed value", () => {
    // With vulnerability=1 every threat event becomes a loss event, and frequency and
    // magnitude are fixed, so expected annual loss = frequency * magnitude exactly.
    const frequency = 5;
    const magnitude = 10_000;
    const input: RiskScenarioInput = {
      threatEventFrequency: fixed(frequency),
      vulnerability: fixed(1),
      lossMagnitude: fixed(magnitude),
    };

    const result = runSimulation(input, { iterations: 20_000, seed: 2 });
    const expected = frequency * magnitude;

    expect(result.ale).toBeGreaterThan(expected * 0.9);
    expect(result.ale).toBeLessThan(expected * 1.1);
  });

  it("produces a higher ALE for a scenario with higher vulnerability", () => {
    const base: RiskScenarioInput = {
      threatEventFrequency: { min: 2, mostLikely: 5, max: 10 },
      vulnerability: { min: 0.05, mostLikely: 0.1, max: 0.2 },
      lossMagnitude: { min: 1_000, mostLikely: 5_000, max: 20_000 },
    };
    const higherVulnerability: RiskScenarioInput = {
      ...base,
      vulnerability: { min: 0.5, mostLikely: 0.7, max: 0.9 },
    };

    const low = runSimulation(base, { iterations: 10_000, seed: 3 });
    const high = runSimulation(higherVulnerability, { iterations: 10_000, seed: 3 });

    expect(high.ale).toBeGreaterThan(low.ale);
  });

  it("orders percentiles and bounds consistently", () => {
    const input: RiskScenarioInput = {
      threatEventFrequency: { min: 1, mostLikely: 3, max: 8 },
      vulnerability: { min: 0.1, mostLikely: 0.2, max: 0.4 },
      lossMagnitude: { min: 1_000, mostLikely: 5_000, max: 50_000 },
    };
    const result = runSimulation(input, { iterations: 5000, seed: 4 });

    expect(result.min).toBeLessThanOrEqual(result.percentiles.p10);
    expect(result.percentiles.p10).toBeLessThanOrEqual(result.percentiles.p50);
    expect(result.percentiles.p50).toBeLessThanOrEqual(result.percentiles.p90);
    expect(result.percentiles.p90).toBeLessThanOrEqual(result.percentiles.p95);
    expect(result.percentiles.p95).toBeLessThanOrEqual(result.percentiles.p99);
    expect(result.percentiles.p99).toBeLessThanOrEqual(result.max);
    expect(result.cvar95).toBeGreaterThanOrEqual(result.percentiles.p95);
  });
});
