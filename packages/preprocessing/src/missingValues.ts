import type { ColumnType } from "@tavolio/table";

const MISSING = new Set(["", "na", "n/a", "null", "none", "nan", "-", "--", "?"]);

export function isMissingValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  if (typeof v === "string") return MISSING.has(v.trim().toLowerCase());
  return false;
}

export function missingRate(values: unknown[]): number {
  if (values.length === 0) return 1;
  let missing = 0;
  for (const v of values) if (isMissingValue(v)) missing++;
  return missing / values.length;
}

export function nonMissing(values: unknown[]): unknown[] {
  return values.filter((v) => !isMissingValue(v));
}

export function inferNullable(values: unknown[]): boolean {
  return values.some((v) => isMissingValue(v));
}

export type { ColumnType };
