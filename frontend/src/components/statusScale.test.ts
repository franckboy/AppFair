import { describe, expect, it } from "vitest";
import { riskLevelFor, riskLevelForAle } from "./statusScale";

describe("riskLevelFor", () => {
  it("returns low for the lowest likelihood/severity combination", () => {
    expect(riskLevelFor(0, 0)).toBe("low");
  });

  it("returns critical for the highest likelihood/severity combination", () => {
    expect(riskLevelFor(3, 3)).toBe("critical");
  });

  it("is symmetric in its two inputs", () => {
    expect(riskLevelFor(1, 3)).toBe(riskLevelFor(3, 1));
    expect(riskLevelFor(2, 2)).toBe(riskLevelFor(1, 3));
  });
});

describe("riskLevelForAle", () => {
  it("classifies below every threshold as low", () => {
    expect(riskLevelForAle(0)).toBe("low");
    expect(riskLevelForAle(50_000)).toBe("low");
  });

  it("classifies just above each threshold correctly", () => {
    expect(riskLevelForAle(50_001)).toBe("medium");
    expect(riskLevelForAle(125_001)).toBe("high");
    expect(riskLevelForAle(250_001)).toBe("critical");
  });

  it("treats an exact threshold value as still belonging to the lower band", () => {
    expect(riskLevelForAle(125_000)).toBe("medium");
    expect(riskLevelForAle(250_000)).toBe("high");
  });
});
