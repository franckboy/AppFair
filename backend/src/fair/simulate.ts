import { createRng, samplePert, samplePoisson, type Rng } from "./random.js";
import { conditionalValueAtRisk, mean, quantile } from "./statistics.js";

/** A PERT estimate: an expert's min / most-likely / max range for an uncertain quantity. */
export interface PertEstimate {
  min: number;
  mostLikely: number;
  max: number;
}

export interface LossCategoryInput {
  key: string;
  estimate: PertEstimate;
}

export interface RiskScenarioInput {
  /** Threat Event Frequency: annual rate at which the threat acts against the asset. */
  threatEventFrequency: PertEstimate;
  /** Vulnerability: probability (0-1) that a threat event becomes a loss event. */
  vulnerability: PertEstimate;
  /** Loss magnitude broken into named categories — a single loss event sums across all of them. */
  lossMagnitudeCategories: LossCategoryInput[];
}

export interface SimulationOptions {
  iterations?: number;
  /** Seed for the PRNG. Omit for a non-deterministic run, set it for reproducible results (e.g. tests). */
  seed?: number;
  /**
   * Also track per-iteration factor samples for sensitivity analysis (see `fair/sensitivity.ts`).
   * Adds a small memory/CPU cost — leave off for repeated calls that don't need it (e.g. the
   * dashboard, which runs this once per scenario).
   */
  trackFactors?: boolean;
}

export interface FactorSamples {
  threatEventFrequency: number[];
  vulnerability: number[];
  lossMagnitudeCategories: Record<string, number[]>;
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
  /** Only present when `options.trackFactors` is true. */
  factorSamples?: FactorSamples;
  /** Per-iteration annual loss in iteration order, paired with `factorSamples` — only present alongside it. */
  losses?: number[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

interface IterationResult {
  annualLoss: number;
  tef: number;
  /**
   * Mean of the vulnerability draws made this iteration (one per threat event attempt,
   * whether or not it became a loss event). Falls back to the PERT's most-likely value
   * when zero threat events occurred, so a quiet year doesn't register as "vulnerability
   * was 0" for sensitivity purposes — it register as "unmeasured, assume typical."
   */
  meanVulnerability: number;
  /** Mean loss draw per category, over loss events only; same fallback-to-most-likely when none occurred. */
  meanLossByCategory: Record<string, number>;
}

function simulateIteration(input: RiskScenarioInput, rng: Rng): IterationResult {
  const { threatEventFrequency, vulnerability, lossMagnitudeCategories } = input;

  const tef = Math.max(0, samplePert(threatEventFrequency.min, threatEventFrequency.mostLikely, threatEventFrequency.max, rng));
  const threatEventCount = samplePoisson(tef, rng);

  let annualLoss = 0;
  let vulnSum = 0;
  let lossEventCount = 0;
  const categorySums: Record<string, number> = {};
  for (const category of lossMagnitudeCategories) categorySums[category.key] = 0;

  for (let i = 0; i < threatEventCount; i++) {
    const vulnProbability = clamp01(samplePert(vulnerability.min, vulnerability.mostLikely, vulnerability.max, rng));
    vulnSum += vulnProbability;
    const isLossEvent = rng() < vulnProbability;
    if (!isLossEvent) continue;

    lossEventCount++;
    for (const category of lossMagnitudeCategories) {
      const value = Math.max(
        0,
        samplePert(category.estimate.min, category.estimate.mostLikely, category.estimate.max, rng),
      );
      categorySums[category.key] += value;
      annualLoss += value;
    }
  }

  const meanVulnerability = threatEventCount > 0 ? vulnSum / threatEventCount : vulnerability.mostLikely;
  const meanLossByCategory: Record<string, number> = {};
  for (const category of lossMagnitudeCategories) {
    meanLossByCategory[category.key] =
      lossEventCount > 0 ? categorySums[category.key] / lossEventCount : category.estimate.mostLikely;
  }

  return { annualLoss, tef, meanVulnerability, meanLossByCategory };
}

/** Runs a FAIR Monte Carlo simulation and summarizes the resulting annual-loss distribution. */
export function runSimulation(input: RiskScenarioInput, options: SimulationOptions = {}): SimulationResult {
  const iterations = options.iterations ?? 10_000;
  const rng = options.seed !== undefined ? createRng(options.seed) : Math.random;

  const losses: number[] = new Array(iterations);
  const tefSamples: number[] = options.trackFactors ? new Array(iterations) : [];
  const vulnSamples: number[] = options.trackFactors ? new Array(iterations) : [];
  const categorySamples: Record<string, number[]> = {};
  if (options.trackFactors) {
    for (const category of input.lossMagnitudeCategories) categorySamples[category.key] = new Array(iterations);
  }

  for (let i = 0; i < iterations; i++) {
    const iterationResult = simulateIteration(input, rng);
    losses[i] = iterationResult.annualLoss;
    if (options.trackFactors) {
      tefSamples[i] = iterationResult.tef;
      vulnSamples[i] = iterationResult.meanVulnerability;
      for (const category of input.lossMagnitudeCategories) {
        categorySamples[category.key][i] = iterationResult.meanLossByCategory[category.key];
      }
    }
  }

  const sorted = [...losses].sort((a, b) => a - b);

  const result: SimulationResult = {
    ale: mean(sorted),
    percentiles: {
      p10: quantile(sorted, 0.1),
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
    },
    cvar95: conditionalValueAtRisk(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    iterations,
  };

  if (options.trackFactors) {
    result.factorSamples = {
      threatEventFrequency: tefSamples,
      vulnerability: vulnSamples,
      lossMagnitudeCategories: categorySamples,
    };
    result.losses = losses;
  }

  return result;
}
