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

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Picks white or ink for a label inside a colored fill, by whichever clears more contrast. */
export function textColorFor(hex: string): string {
  const l = relativeLuminance(hex);
  return contrastRatio(l, 1) >= contrastRatio(l, 0) ? "#ffffff" : "#0b0b0b";
}
