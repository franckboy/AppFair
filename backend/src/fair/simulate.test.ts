import { describe, expect, it } from "vitest";
import { runSimulation, type RiskScenarioInput } from "./simulate.js";

function fixed(value: number) {
  return { min: value, mostLikely: value, max: value };
}

function oneCategory(key: string, value: ReturnType<typeof fixed>) {
  return [{ key, estimate: value }];
}

describe("runSimulation", () => {
  it("is deterministic for a given seed", () => {
    const input: RiskScenarioInput = {
      threatEventFrequency: { min: 1, mostLikely: 4, max: 12 },
      vulnerability: { min: 0.1, mostLikely: 0.3, max: 0.6 },
      lossMagnitudeCategories: oneCategory("reemplazo", { min: 5_000, mostLikely: 20_000, max: 100_000 }),
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
      lossMagnitudeCategories: oneCategory("reemplazo", fixed(magnitude)),
    };

    const result = runSimulation(input, { iterations: 20_000, seed: 2 });
    const expected = frequency * magnitude;

    expect(result.ale).toBeGreaterThan(expected * 0.9);
    expect(result.ale).toBeLessThan(expected * 1.1);
  });

  it("sums fixed loss across multiple categories per event", () => {
    const frequency = 5;
    const input: RiskScenarioInput = {
      threatEventFrequency: fixed(frequency),
      vulnerability: fixed(1),
      lossMagnitudeCategories: [
        { key: "reemplazo", estimate: fixed(10_000) },
        { key: "reputacion", estimate: fixed(4_000) },
        { key: "multas", estimate: fixed(1_000) },
      ],
    };

    const result = runSimulation(input, { iterations: 20_000, seed: 5 });
    const expected = frequency * (10_000 + 4_000 + 1_000);

    expect(result.ale).toBeGreaterThan(expected * 0.9);
    expect(result.ale).toBeLessThan(expected * 1.1);
  });

  it("produces a higher ALE for a scenario with higher vulnerability", () => {
    const base: RiskScenarioInput = {
      threatEventFrequency: { min: 2, mostLikely: 5, max: 10 },
      vulnerability: { min: 0.05, mostLikely: 0.1, max: 0.2 },
      lossMagnitudeCategories: oneCategory("reemplazo", { min: 1_000, mostLikely: 5_000, max: 20_000 }),
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
      lossMagnitudeCategories: oneCategory("reemplazo", { min: 1_000, mostLikely: 5_000, max: 50_000 }),
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

  describe("trackFactors", () => {
    const input: RiskScenarioInput = {
      threatEventFrequency: { min: 1, mostLikely: 3, max: 8 },
      vulnerability: { min: 0.1, mostLikely: 0.2, max: 0.4 },
      lossMagnitudeCategories: [
        { key: "reemplazo", estimate: { min: 1_000, mostLikely: 5_000, max: 50_000 } },
        { key: "reputacion", estimate: { min: 500, mostLikely: 2_000, max: 10_000 } },
      ],
    };

    it("omits factorSamples/losses when not requested", () => {
      const result = runSimulation(input, { iterations: 500, seed: 6 });
      expect(result.factorSamples).toBeUndefined();
      expect(result.losses).toBeUndefined();
    });

    it("returns one sample per iteration per factor, aligned with losses", () => {
      const iterations = 500;
      const result = runSimulation(input, { iterations, seed: 6, trackFactors: true });

      expect(result.losses).toHaveLength(iterations);
      expect(result.factorSamples!.threatEventFrequency).toHaveLength(iterations);
      expect(result.factorSamples!.vulnerability).toHaveLength(iterations);
      expect(result.factorSamples!.lossMagnitudeCategories.reemplazo).toHaveLength(iterations);
      expect(result.factorSamples!.lossMagnitudeCategories.reputacion).toHaveLength(iterations);
    });

    it("falls back to the PERT's most-likely value in a quiet iteration (no events)", () => {
      // TEF effectively 0 => Poisson always draws 0 events => vulnerability/category
      // samples for that iteration have nothing to average, so they fall back rather
      // than reporting a misleading 0.
      const quiet: RiskScenarioInput = {
        threatEventFrequency: fixed(0),
        vulnerability: { min: 0.1, mostLikely: 0.25, max: 0.4 },
        lossMagnitudeCategories: oneCategory("reemplazo", { min: 1_000, mostLikely: 5_000, max: 10_000 }),
      };
      const result = runSimulation(quiet, { iterations: 50, seed: 7, trackFactors: true });

      expect(result.factorSamples!.vulnerability.every((v) => v === 0.25)).toBe(true);
      expect(result.factorSamples!.lossMagnitudeCategories.reemplazo.every((v) => v === 5_000)).toBe(true);
    });
  });
});
