export const currencyFull = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
export const percent1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

const decimal1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

/**
 * Intl's built-in compact notation for es-AR mixes "K"/"k" case at the 10,000
 * boundary (a real CLDR quirk, not a locale we're misusing), which looks broken
 * on a dashboard of financial figures — so this formats compact numbers by hand
 * with a fixed-case suffix instead.
 */
export const currencyCompact = {
  format(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${decimal1.format(value / 1_000_000)} M`;
    if (abs >= 1_000) return `${decimal1.format(value / 1_000)} K`;
    return currencyFull.format(value);
  },
};
