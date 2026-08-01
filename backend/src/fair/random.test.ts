import { describe, expect, it } from "vitest";
import { createRng, samplePert, samplePoisson } from "./random.js";

describe("createRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0, 1)", () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("samplePert", () => {
  it("returns min when min === max", () => {
    const rng = createRng(7);
    for (let i = 0; i < 20; i++) {
      expect(samplePert(5, 5, 5, rng)).toBe(5);
    }
  });

  it("stays within [min, max]", () => {
    const rng = createRng(123);
    for (let i = 0; i < 5000; i++) {
      const v = samplePert(10, 30, 100, rng);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("approximates the PERT mean over many samples", () => {
    const rng = createRng(456);
    const min = 10;
    const mostLikely = 20;
    const max = 100;
    const expectedMean = (min + 4 * mostLikely + max) / 6;

    const n = 50_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += samplePert(min, mostLikely, max, rng);
    const observedMean = sum / n;

    expect(observedMean).toBeGreaterThan(expectedMean * 0.95);
    expect(observedMean).toBeLessThan(expectedMean * 1.05);
  });
});

describe("samplePoisson", () => {
  it("returns 0 for lambda <= 0", () => {
    const rng = createRng(1);
    expect(samplePoisson(0, rng)).toBe(0);
    expect(samplePoisson(-1, rng)).toBe(0);
  });

  it("approximates lambda as the mean over many samples", () => {
    const rng = createRng(99);
    const lambda = 6;
    const n = 20_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += samplePoisson(lambda, rng);
    const observedMean = sum / n;

    expect(observedMean).toBeGreaterThan(lambda * 0.9);
    expect(observedMean).toBeLessThan(lambda * 1.1);
  });
});
