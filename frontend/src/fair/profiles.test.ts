import { describe, expect, it } from "vitest";
import {
  ATTACKER_PROFILES,
  computeVulnerability,
  DEFENSE_PROFILES,
  profileAverage,
} from "./profiles";

describe("profileAverage", () => {
  it("averages a profile's named factors", () => {
    const profile = ATTACKER_PROFILES.oportunista;
    const expected = Object.values(profile.factors).reduce((sum, v) => sum + v, 0) / Object.values(profile.factors).length;
    expect(profileAverage(profile)).toBeCloseTo(expected, 10);
  });

  it("matches a hand-computed average for a defense profile", () => {
    expect(profileAverage(DEFENSE_PROFILES.basica)).toBeCloseTo((20 + 30 + 30 + 30 + 20 + 30) / 6, 10);
  });
});

describe("computeVulnerability", () => {
  it("computes mostLikely as attacker × (1 − defense)", () => {
    const result = computeVulnerability(80, 50, "alto");
    expect(result.mostLikely).toBeCloseTo(0.4, 2);
  });

  it("widens min/max spread as confidence drops", () => {
    const alto = computeVulnerability(80, 50, "alto");
    const bajo = computeVulnerability(80, 50, "bajo");
    const altoWidth = alto.max - alto.min;
    const bajoWidth = bajo.max - bajo.min;
    expect(bajoWidth).toBeGreaterThan(altoWidth);
  });

  it("keeps min/mostLikely/max within [0, 1] at the extremes", () => {
    const result = computeVulnerability(100, 0, "bajo");
    expect(result.min).toBeGreaterThanOrEqual(0);
    expect(result.max).toBeLessThanOrEqual(1);
    expect(result.min).toBeLessThanOrEqual(result.mostLikely);
    expect(result.mostLikely).toBeLessThanOrEqual(result.max);
  });

  it("never produces a mostLikely of exactly 0 or 100 (clamped to 1..99)", () => {
    const zero = computeVulnerability(0, 100, "alto");
    const full = computeVulnerability(100, 0, "alto");
    expect(zero.mostLikely).toBeCloseTo(0.01, 5);
    expect(full.mostLikely).toBeCloseTo(0.99, 5);
  });
});
