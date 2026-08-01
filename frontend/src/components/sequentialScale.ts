/** Documented sequential ramp (blue, 100→700) from the design system's palette reference — never an eyeballed/interpolated hex. */
export const SEQUENTIAL_STEPS = [
  "#cde2fb",
  "#b7d3f6",
  "#9ec5f4",
  "#86b6ef",
  "#6da7ec",
  "#5598e7",
  "#3987e5",
  "#2a78d6",
  "#256abf",
  "#1c5cab",
  "#184f95",
  "#104281",
  "#0d366b",
];

export function sequentialColor(value: number, max: number): string {
  if (max <= 0) return SEQUENTIAL_STEPS[0];
  const t = Math.min(1, Math.max(0, value / max));
  const index = Math.round(t * (SEQUENTIAL_STEPS.length - 1));
  return SEQUENTIAL_STEPS[index];
}
