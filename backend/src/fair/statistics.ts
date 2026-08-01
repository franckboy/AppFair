/** Linear-interpolation percentile, matching the common "R-7" convention. `p` is in [0, 1]. */
export function quantile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) throw new Error("quantile: values must not be empty");
  if (sortedValues.length === 1) return sortedValues[0];

  const index = p * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];

  const fraction = index - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * fraction;
}

export function mean(values: number[]): number {
  if (values.length === 0) throw new Error("mean: values must not be empty");
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Conditional Value at Risk at `confidence` (e.g. 0.95): the average loss in the
 * worst (1 - confidence) share of outcomes. `sortedValues` must be ascending.
 */
export function conditionalValueAtRisk(sortedValues: number[], confidence: number): number {
  const varThreshold = quantile(sortedValues, confidence);
  const tail = sortedValues.filter((v) => v >= varThreshold);
  return mean(tail);
}
