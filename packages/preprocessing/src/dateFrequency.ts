export type DateFrequency = "Intraday" | "Daily" | "Weekly" | "Monthly" | "Annually";

const DAY_MS = 86_400_000;

/** Gap sizes in days that count as each frequency (daily allows the weekend jump of business-day data). */
const BANDS: Array<{ name: DateFrequency; lo: number; hi: number }> = [
  { name: "Daily", lo: 0.5, hi: 3.5 },
  { name: "Weekly", lo: 6, hi: 8 },
  { name: "Monthly", lo: 27, hi: 32 },
  { name: "Annually", lo: 360, hi: 371 },
];

/** Share of gaps that must fit the frequency before it is reported. */
const REGULAR = 0.6;

/**
 * How often a date column ticks: Daily, Weekly, Monthly or Annually, judged from the gaps between its distinct dates
 * (milliseconds since epoch, any order, repeats allowed). Null when there are too few dates or the gaps aren't regular.
 * The typical gap picks the candidate; at least 60% of gaps must fit it, so a few missing periods don't spoil it.
 */
export function detectDateFrequency(times: number[]): DateFrequency | null {
  const distinct = [...new Set(times.filter(Number.isFinite))].sort((a, b) => a - b);
  if (distinct.length < 4) return null;
  const gaps = distinct.slice(1).map((t, i) => (t - distinct[i]!) / DAY_MS);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  if (median < 0.5) return gaps.filter((g) => g < 0.5).length / gaps.length >= REGULAR ? "Intraday" : null;
  const band = BANDS.find((b) => median >= (b.name === "Daily" ? 0.5 : b.lo) && median <= (b.name === "Daily" ? 1.5 : b.hi));
  if (!band) return null;
  return gaps.filter((g) => g >= band.lo && g <= band.hi).length / gaps.length >= REGULAR ? band.name : null;
}
