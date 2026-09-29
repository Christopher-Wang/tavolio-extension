import { isMissingValue } from "./missingValues.js";

/** Model-agnostic categorical stats (no vocabulary encoding here — adapters own that). */
export function categoricalStats(values: unknown[]): {
  cardinality: number;
  topValues: Array<{ value: string; count: number }>;
} {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (isMissingValue(v)) continue;
    const k = String(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const topValues = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return { cardinality: counts.size, topValues };
}
