import type { FactorSamples } from "./simulate.js";

/** Pearson correlation coefficient between two equal-length sample arrays. 0 when either has no variance. */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0 || n !== y.length) throw new Error("pearsonCorrelation: arrays must be non-empty and equal length");

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  return denominator === 0 ? 0 : numerator / denominator;
}

export interface SensitivityFactor {
  name: string;
  correlation: number;
}

/**
 * Ranks how much each FAIR input drives the variability of the annual loss, via each
 * input's Pearson correlation with `losses` — the tornado-chart view of a Monte Carlo
 * simulation. Requires a simulation run with `options.trackFactors: true`.
 */
export function computeSensitivity(
  factorSamples: FactorSamples,
  lossCategoryLabels: Record<string, string>,
  losses: number[],
): SensitivityFactor[] {
  const factors: SensitivityFactor[] = [
    { name: "Frecuencia de Evento de Amenaza (TEF)", correlation: pearsonCorrelation(factorSamples.threatEventFrequency, losses) },
    { name: "Vulnerabilidad", correlation: pearsonCorrelation(factorSamples.vulnerability, losses) },
    ...Object.entries(factorSamples.lossMagnitudeCategories).map(([key, samples]) => ({
      name: `Magnitud: ${lossCategoryLabels[key] ?? key}`,
      correlation: pearsonCorrelation(samples, losses),
    })),
  ];

  return factors.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}
