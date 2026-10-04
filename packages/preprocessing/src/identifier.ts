import type { ColumnType } from "@tavolio/table";

/**
 * Unique-per-row values are normally identifiers (§13), but two kinds of column are legitimately unique and carry signal:
 * a date (one row per day) and a continuous measure (any non-integer number). Those are exempt from the identifier rule.
 * `observed` is the column's non-missing values.
 */
export function exemptFromIdentifierRule(type: ColumnType, observed: unknown[]): boolean {
  if (type === "datetime") return true;
  if (type !== "numeric") return false;
  return observed.some((v) => {
    const n = typeof v === "number" ? v : Number(String(v).trim().replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) && !Number.isInteger(n);
  });
}
