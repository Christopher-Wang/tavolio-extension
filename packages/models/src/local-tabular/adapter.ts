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

function mean(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Model-specific preprocessing. The canonical table stays untouched;
 * each adapter encodes features the way its artifact expects.
 */
export function encodeFeatures(
  table: Table,
  schema: ColumnSchema[],
  target: string,
): { frame: EncodedFrame; categories: Map<string, Map<string, number>> } {
  const featureCols = schema.filter((c) => c.name !== target);
  const colIndex = new Map(table.columns.map((c, i) => [c.name, i]));
  const categories = new Map<string, Map<string, number>>();

  // Build vocabularies for categorical/boolean/text + datetime -> epoch.
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

  const featureNames: string[] = [];
  for (const col of featureCols) {
    if (categories.has(col.name)) {
      const vocab = categories.get(col.name)!;
      for (const key of vocab.keys()) featureNames.push(`${col.name}__${key}`);
      featureNames.push(`${col.name}__MISSING`);
    } else {
      featureNames.push(col.name);
    }
  }

  // Numeric column means for imputation.
  const numericMeans = new Map<string, number>();
  for (const col of featureCols) {
    if (col.type === "numeric" || col.type === "datetime") {
      const idx = colIndex.get(col.name)!;
      const nums: number[] = [];
      for (const row of table.rows) {
        const v = row[idx];
        const n = col.type === "datetime"
          ? v instanceof Date
            ? v.getTime()
            : isMissingValue(v)
              ? null
              : Date.parse(String(v))
          : toNumber(v);
        if (n !== null && Number.isFinite(n)) nums.push(n);
      }
      numericMeans.set(col.name, nums.length > 0 ? mean(nums) : 0);
    }
  }

  const matrix: number[][] = table.rows.map((row) => {
    const out: number[] = [];
    for (const col of featureCols) {
      const idx = colIndex.get(col.name)!;
      const v = row[idx];
      if (categories.has(col.name)) {
        const vocab = categories.get(col.name)!;
        const key = col.type === "boolean" ? String(v).toLowerCase() : String(v);
        const oneHot = new Array(vocab.size).fill(0);
        if (!isMissingValue(v) && vocab.has(key)) oneHot[vocab.get(key)!] = 1;
        out.push(...oneHot, isMissingValue(v) ? 1 : 0);
      } else {
        let n: number | null;
        if (col.type === "datetime") {
          n = v instanceof Date
            ? v.getTime()
            : isMissingValue(v)
              ? null
              : Date.parse(String(v));
          if (n !== null && !Number.isFinite(n)) n = null;
        } else {
          n = toNumber(v);
        }
        out.push(n ?? numericMeans.get(col.name) ?? 0);
      }
    }
    return out;
  });

  const rowMask = table.rows.map(() => true);
  return { frame: { featureNames, matrix, rowMask }, categories };
}
