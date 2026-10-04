import { isMissingValue } from "./missingValues.js";

/** Model-agnostic categorical stats (no vocabulary encoding here — adapters own that). */
export function categoricalStats(values: unknown[]): {
  cardinality: number;
  /** Each value once, with the spellings in the column that were folded into it (most common first, `value` among them). */
  topValues: Array<{ value: string; count: number; variants: Array<{ spelling: string; count: number }> }>;
} {
  // Spellings that differ only in case or surrounding spaces are one value ("Yes", "yes", "Yes "), as in profileColumns().
  // It is listed under its most common spelling (trimmed); every raw spelling is kept so a UI can show what was folded in.
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const v of values) {
    if (isMissingValue(v)) continue;
    const spelling = String(v);
    const key = spelling.trim().toLowerCase();
    const g = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    g.count++;
    g.spellings.set(spelling, (g.spellings.get(spelling) ?? 0) + 1);
    groups.set(key, g);
  }
  const topValues = [...groups.values()]
    .map((g) => {
      const variants = [...g.spellings].sort((x, y) => y[1] - x[1]).map(([spelling, count]) => ({ spelling, count }));
      return { value: variants[0]!.spelling.trim(), count: g.count, variants };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return { cardinality: groups.size, topValues };
}
