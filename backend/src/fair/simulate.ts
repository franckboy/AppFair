import { createRng, samplePert, samplePoisson, type Rng } from "./random.js";
import { conditionalValueAtRisk, mean, quantile } from "./statistics.js";

/** A PERT estimate: an expert's min / most-likely / max range for an uncertain quantity. */
export interface PertEstimate {
  min: number;
  mostLikely: number;
  max: number;
}

export interface RiskScenarioInput {
  /** Threat Event Frequency: annual rate at which the threat acts against the asset. */
  threatEventFrequency: PertEstimate;
  /** Vulnerability: probability (0-1) that a threat event becomes a loss event. */
  vulnerability: PertEstimate;
  /** Loss Magnitude: economic impact of a single loss event, in currency units. */
  lossMagnitude: PertEstimate;
}

export interface SimulationOptions {
  iterations?: number;
  /** Seed for the PRNG. Omit for a non-deterministic run, set it for reproducible results (e.g. tests). */
  seed?: number;
}

export interface SimulationResult {
  /** Annualized Loss Expectancy: mean simulated annual loss. */
  ale: number;
  percentiles: {
    p10: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  /** Conditional Value at Risk at 95%: average loss across the worst 5% of years. */
  cvar95: number;
  min: number;
  max: number;
  iterations: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function simulateAnnualLoss(input: RiskScenarioInput, rng: Rng): number {
  const { threatEventFrequency, vulnerability, lossMagnitude } = input;

  const tef = Math.max(0, samplePert(threatEventFrequency.min, threatEventFrequency.mostLikely, threatEventFrequency.max, rng));
  const threatEventCount = samplePoisson(tef, rng);

  let annualLoss = 0;
  for (let i = 0; i < threatEventCount; i++) {
    const vulnProbability = clamp01(samplePert(vulnerability.min, vulnerability.mostLikely, vulnerability.max, rng));
    const isLossEvent = rng() < vulnProbability;
    if (!isLossEvent) continue;

    annualLoss += Math.max(0, samplePert(lossMagnitude.min, lossMagnitude.mostLikely, lossMagnitude.max, rng));
  }

  return annualLoss;
}

/** Runs a FAIR Monte Carlo simulation and summarizes the resulting annual-loss distribution. */
export function runSimulation(input: RiskScenarioInput, options: SimulationOptions = {}): SimulationResult {
  const iterations = options.iterations ?? 10_000;
  const rng = options.seed !== undefined ? createRng(options.seed) : Math.random;

  const samples: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    samples[i] = simulateAnnualLoss(input, rng);
  }
  samples.sort((a, b) => a - b);

  return {
    ale: mean(samples),
    percentiles: {
      p10: quantile(samples, 0.1),
      p50: quantile(samples, 0.5),
      p90: quantile(samples, 0.9),
      p95: quantile(samples, 0.95),
      p99: quantile(samples, 0.99),
    },
    cvar95: conditionalValueAtRisk(samples, 0.95),
    min: samples[0],
    max: samples[samples.length - 1],
    iterations,
  };
}
