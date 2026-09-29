import { isMissingValue } from "./missingValues.js";

/** Parse datetimes without imposing model features. */
export function parseDatetimeValues(values: unknown[]): Array<Date | null> {
  return values.map((v) => {
    if (isMissingValue(v)) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v !== "string" && typeof v !== "number") return null;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? new Date(t) : null;
  });
}

export function datetimeRange(values: unknown[]): { min: Date; max: Date } | null {
  const parsed = parseDatetimeValues(values).filter((d): d is Date => d !== null);
  if (parsed.length === 0) return null;
  let min = parsed[0]!;
  let max = parsed[0]!;
  for (const d of parsed) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}
