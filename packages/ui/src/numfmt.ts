/**
 * One number format for the whole pane: plain up to 9,999, then K/M/B/T,
 * scientific beyond that (or for tiny values), so it always fits a 300px column.
 */
export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const abs = Math.abs(x);
  if (abs === 0) return "0";
  if (abs >= 1e15 || abs < 1e-3) return x.toExponential(2).replace(/\.?0+e/, "e").replace("e+", "e");
  if (abs >= 10_000) return x.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  if (abs >= 100) return Math.round(x).toLocaleString("en-US");
  if (abs >= 1) return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return x.toLocaleString("en-US", { maximumSignificantDigits: 2 });
}
