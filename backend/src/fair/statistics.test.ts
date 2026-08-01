import { describe, expect, it } from "vitest";
import { conditionalValueAtRisk, mean, quantile } from "./statistics.js";

describe("quantile", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns the min at p=0 and max at p=1", () => {
    expect(quantile(sorted, 0)).toBe(1);
    expect(quantile(sorted, 1)).toBe(10);
  });

  it("interpolates the median at p=0.5", () => {
    expect(quantile(sorted, 0.5)).toBeCloseTo(5.5);
  });

  it("returns the only value for a single-element array", () => {
    expect(quantile([42], 0.9)).toBe(42);
  });
});

describe("mean", () => {
  it("averages values", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("conditionalValueAtRisk", () => {
  it("averages the tail at and above the confidence threshold", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    // p95 -> quantile index 0.95*99=94.05 -> interpolated ~95.05, tail is values >= that: {96..100}
    const result = conditionalValueAtRisk(sorted, 0.95);
    expect(result).toBeCloseTo((96 + 97 + 98 + 99 + 100) / 5);
  });
});
