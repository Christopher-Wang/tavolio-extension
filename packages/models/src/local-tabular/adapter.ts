import { isMissingValue } from "@tavolio/preprocessing";
import type { ColumnSchema, Table } from "@tavolio/table";

export interface EncodedFrame {
  featureNames: string[];
  matrix: number[][];
  rowMask: boolean[];
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const s = v.trim().replace(/[$,%\s]/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function toDateNumber(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (isMissingValue(v)) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function mean(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function isUsableFeature(col: ColumnSchema, table: Table): boolean {
  if (col.type === "text") return false;
  const idx = table.columns.findIndex((c) => c.name === col.name);
  if (idx === -1) return true;
  const seen = new Set<string>();
  let n = 0;
  for (const row of table.rows) {
    const v = row[idx];
    if (isMissingValue(v)) continue;
    n++;
    seen.add(String(v).trim().toLowerCase());
  }
  // Unique-per-row values are identifiers (§4): no signal, huge one-hot width.
  if (n >= 3 && seen.size === n) return false;
  // >60% missing: too sparse to help.
  if (table.rows.length >= 5 && n / table.rows.length < 0.4) return false;
  return true;
}

interface Fitted {
  featureCols: ColumnSchema[];
  colIndex: Map<string, number>;
  categories: Map<string, Map<string, number>>;
  numericMeans: Map<string, number>;
}

function fit(table: Table, schema: ColumnSchema[], target: string, featureCols: ColumnSchema[]): Fitted {
  const colIndex = new Map(table.columns.map((c, i) => [c.name, i]));
  const categories = new Map<string, Map<string, number>>();

  for (const col of featureCols) {
    if (col.type === "categorical" || col.type === "boolean" || col.type === "text" || col.type === "ordinal") {
      const idx = colIndex.get(col.name)!;
      const vocab = new Map<string, number>();
      for (const row of table.rows) {
        const v = row[idx];
        if (isMissingValue(v)) continue;
        const key = col.type === "boolean" ? String(v).toLowerCase() : String(v);
        if (!vocab.has(key)) vocab.set(key, vocab.size);
      }
      categories.set(col.name, vocab);
    }
  }

  const numericMeans = new Map<string, number>();
  for (const col of featureCols) {
    if (col.type === "numeric" || col.type === "datetime") {
      const idx = colIndex.get(col.name)!;
      const nums: number[] = [];
      for (const row of table.rows) {
        const v = row[idx];
        const n = col.type === "datetime" ? toDateNumber(v) : toNumber(v);
        if (n !== null && Number.isFinite(n)) nums.push(n);
      }
      numericMeans.set(col.name, nums.length > 0 ? mean(nums) : 0);
    }
  }
  void schema;
  void target;
  return { featureCols, colIndex, categories, numericMeans };
}

function featureNamesOf(fitted: Fitted): string[] {
  const names: string[] = [];
  for (const col of fitted.featureCols) {
    if (fitted.categories.has(col.name)) {
      const vocab = fitted.categories.get(col.name)!;
      for (const key of vocab.keys()) names.push(`${col.name}__${key}`);
      names.push(`${col.name}__MISSING`);
    } else {
      names.push(col.name);
    }
  }
  return names;
}

function encodeOne(fitted: Fitted, row: unknown[]): number[] {
  const out: number[] = [];
  for (const col of fitted.featureCols) {
    const idx = fitted.colIndex.get(col.name)!;
    const v = row[idx];
    if (fitted.categories.has(col.name)) {
      const vocab = fitted.categories.get(col.name)!;
      const key = col.type === "boolean" ? String(v).toLowerCase() : String(v);
      const oneHot = new Array(vocab.size).fill(0);
      if (!isMissingValue(v) && vocab.has(key)) oneHot[vocab.get(key)!] = 1;
      out.push(...oneHot, isMissingValue(v) ? 1 : 0);
    } else {
      const n = col.type === "datetime" ? toDateNumber(v) : toNumber(v);
      out.push(n ?? fitted.numericMeans.get(col.name) ?? 0);
    }
  }
  return out;
}

/**
 * Model-specific preprocessing. The canonical table stays untouched;
 * each adapter encodes features the way its artifact expects.
 *
 * Identifier-like and free-text columns are excluded from the matrix —
 * profileColumns() already explains that in the sidebar (§4), so the
 * encoder just enforces it.
 */
export function encodeFeatures(
  table: Table,
  schema: ColumnSchema[],
  target: string,
): { frame: EncodedFrame; categories: Map<string, Map<string, number>> } {
  const featureCols = schema.filter((c) => c.name !== target && isUsableFeature(c, table));
  const fitted = fit(table, schema, target, featureCols);
  const matrix = table.rows.map((row) => encodeOne(fitted, row));
  const rowMask = table.rows.map(() => true);
  return { frame: { featureNames: featureNamesOf(fitted), matrix, rowMask }, categories: fitted.categories };
}

/**
 * Encode one row using only `subset` columns, fitted on the full table
 * (vocabularies + imputation reuse the same logic). Used for
 * single-feature signal ranking (§6, §9) without leaking model internals.
 */
export function encodeRowSubset(
  table: Table,
  schema: ColumnSchema[],
  target: string,
  row: unknown[],
  subset: ColumnSchema[],
): number[] {
  const names = new Set(subset.map((c) => c.name));
  const featureCols = schema.filter((c) => names.has(c.name) && c.name !== target);
  if (featureCols.length === 0) return [];
  const fitted = fit(table, schema, target, featureCols);
  return encodeOne(fitted, row);
}

