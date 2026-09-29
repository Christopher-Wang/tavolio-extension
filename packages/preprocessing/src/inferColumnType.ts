import type { ColumnType } from "@tavolio/table";
import { nonMissing } from "./missingValues.js";

const BOOL_STRINGS = new Set([
  "true",
  "false",
  "yes",
  "no",
  "y",
  "n",
  "t",
  "f",
  "0",
  "1",
]);

function isNumericLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  const s = v.trim().replace(/[$,%\s]/g, "");
  if (s === "") return false;
  return Number.isFinite(Number(s));
}

function isBoolLike(v: unknown): boolean {
  if (typeof v === "boolean") return true;
  if (typeof v === "number") return v === 0 || v === 1;
  if (typeof v !== "string") return false;
  return BOOL_STRINGS.has(v.trim().toLowerCase());
}

const DATE_PATTERNS = [
  /^\d{4}-\d{1,2}-\d{1,2}([T ]\d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  /^\d{1,2}-\d{1,2}-\d{2,4}$/,
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}$/i,
];

function isDatetimeLike(v: unknown): boolean {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s === "") return false;
  if (DATE_PATTERNS.some((re) => re.test(s))) return true;
  // Fall back to Date.parse only for strings containing a separator; avoids "42" parsing as year.
  if (!/[-/:,]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

/**
 * Universal fact about a column — independent of any model.
 * Deliberately does NOT encode categories / build vocabularies.
 */
export function inferColumnType(
  name: string,
  values: unknown[],
): { type: ColumnType; confidence: number } {
  const observed = nonMissing(values);
  void name;
  if (observed.length === 0) return { type: "text", confidence: 0.3 };

  const numeric = observed.filter(isNumericLike).length / observed.length;
  if (numeric >= 0.9) {
    return { type: "numeric", confidence: 0.8 + 0.19 * numeric };
  }

  const bools = observed.filter(isBoolLike).length / observed.length;
  const unique = new Set(observed.map((v) => String(v).trim().toLowerCase()));
  if (bools >= 0.9 && unique.size <= 3) {
    return { type: "boolean", confidence: 0.8 + 0.19 * bools };
  }

  const dates = observed.filter(isDatetimeLike).length / observed.length;
  if (dates >= 0.85) {
    return { type: "datetime", confidence: 0.8 + 0.19 * dates };
  }

  // Low-cardinality short strings -> categorical.
  const avgLen =
    observed.reduce<number>((acc, v) => acc + String(v).length, 0) / observed.length;
  const cardinality = unique.size / observed.length;
  if (unique.size <= 50 && (cardinality <= 0.5 || avgLen <= 30)) {
    // Distinguish free text: high cardinality + long strings.
    if (avgLen > 80 && cardinality > 0.5) {
      return { type: "text", confidence: 0.75 };
    }
    return { type: "categorical", confidence: 0.7 + 0.25 * (1 - cardinality) };
  }

  return { type: "text", confidence: 0.7 };
}
