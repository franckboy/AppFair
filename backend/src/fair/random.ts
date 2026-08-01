export type Rng = () => number;

/** Deterministic PRNG (mulberry32) so simulations can be seeded and tests reproducible. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleStandardNormal(rng: Rng): number {
  // Box-Muller transform. Guard against log(0) from a uniform sample of exactly 0.
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Marsaglia-Tsang method. Valid for any alpha > 0 via the boost trick for alpha < 1. */
function sampleGamma(alpha: number, rng: Rng): number {
  if (alpha < 1) {
    const u = rng();
    return sampleGamma(alpha + 1, rng) * Math.pow(u, 1 / alpha);
  }

  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleStandardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;

    const u = rng();
    const x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) return d * v;
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/**
 * Modified PERT distribution (shape lambda=4, the standard default) sampled on [min, max]
 * and peaked at mostLikely. Used for FAIR inputs (frequency, vulnerability, magnitude)
 * because they are expert range estimates, not single known values.
 */
export function samplePert(
  min: number,
  mostLikely: number,
  max: number,
  rng: Rng,
  lambda = 4,
): number {
  if (min === max) return min;

  const alpha = 1 + (lambda * (mostLikely - min)) / (max - min);
  const beta = 1 + (lambda * (max - mostLikely)) / (max - min);
  const unit = sampleBeta(alpha, beta, rng);
  return min + unit * (max - min);
}

/** Knuth's algorithm. Fine for the small-to-moderate annual frequencies FAIR scenarios use. */
export function samplePoisson(lambda: number, rng: Rng): number {
  if (lambda <= 0) return 0;

  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}
