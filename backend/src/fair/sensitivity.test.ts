import { describe, expect, it } from "vitest";
import { computeSensitivity, pearsonCorrelation } from "./sensitivity.js";
import type { FactorSamples } from "./simulate.js";

describe("pearsonCorrelation", () => {
  it("is 1 for a perfectly increasing linear relationship", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(1);
  });

  it("is -1 for a perfectly decreasing linear relationship", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(-1);
  });

  it("is 0 when x has no variance", () => {
    const x = [5, 5, 5, 5];
    const y = [1, 2, 3, 4];
    expect(pearsonCorrelation(x, y)).toBe(0);
  });

  it("throws on mismatched or empty arrays", () => {
    expect(() => pearsonCorrelation([1, 2], [1])).toThrow();
    expect(() => pearsonCorrelation([], [])).toThrow();
  });
});

describe("computeSensitivity", () => {
  it("ranks factors by |correlation| descending", () => {
    const n = 200;
    const losses = Array.from({ length: n }, (_, i) => i);
    // TEF perfectly tracks losses; vulnerability is unrelated (constant); one loss
    // category anti-correlates.
    const factorSamples: FactorSamples = {
      threatEventFrequency: losses.map((v) => v),
      vulnerability: losses.map(() => 0.3),
      lossMagnitudeCategories: {
        reemplazo: losses.map((v) => n - v),
      },
    };

    const result = computeSensitivity(factorSamples, { reemplazo: "Costos de Reemplazo" }, losses);

    expect(result[0].name).toContain("Frecuencia");
    expect(result[0].correlation).toBeCloseTo(1);
    const reemplazo = result.find((f) => f.name.includes("Reemplazo"))!;
    expect(reemplazo.correlation).toBeCloseTo(-1);
    const vulnerability = result.find((f) => f.name === "Vulnerabilidad")!;
    expect(vulnerability.correlation).toBe(0);
  });

  it("uses the category key as a fallback label when no label is provided", () => {
    const losses = [1, 2, 3];
    const factorSamples: FactorSamples = {
      threatEventFrequency: [1, 1, 1],
      vulnerability: [1, 1, 1],
      lossMagnitudeCategories: { unlabeled_key: [1, 2, 3] },
    };
    const result = computeSensitivity(factorSamples, {}, losses);
    expect(result.some((f) => f.name === "Magnitud: unlabeled_key")).toBe(true);
  });
});
