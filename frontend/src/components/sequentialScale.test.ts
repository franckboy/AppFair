import { describe, expect, it } from "vitest";
import { sequentialColor, SEQUENTIAL_STEPS } from "./sequentialScale";

describe("sequentialColor", () => {
  it("returns the lightest step for value 0", () => {
    expect(sequentialColor(0, 100)).toBe(SEQUENTIAL_STEPS[0]);
  });

  it("returns the darkest step for value === max", () => {
    expect(sequentialColor(100, 100)).toBe(SEQUENTIAL_STEPS[SEQUENTIAL_STEPS.length - 1]);
  });

  it("falls back to the lightest step when max <= 0", () => {
    expect(sequentialColor(5, 0)).toBe(SEQUENTIAL_STEPS[0]);
    expect(sequentialColor(5, -10)).toBe(SEQUENTIAL_STEPS[0]);
  });

  it("clamps a value above max to the darkest step", () => {
    expect(sequentialColor(150, 100)).toBe(SEQUENTIAL_STEPS[SEQUENTIAL_STEPS.length - 1]);
  });

  it("is monotonically non-decreasing in step index as value increases", () => {
    const indices = Array.from({ length: 11 }, (_, i) => SEQUENTIAL_STEPS.indexOf(sequentialColor(i * 10, 100)));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });
});
