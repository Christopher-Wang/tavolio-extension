import type { ColumnSchema, Table } from "@tavolio/table";

export interface FeatureSignal {
  name: string;
  /** Share of the strongest signal, 0..1 (sidebar bar widths). */
  strength: number;
}

/**
 * Cheap, transparent feature attribution for "Most useful signals" (§6, §9).
 * Single-feature kNN skill per candidate feature, normalized to the best.
 * No model internals leak — just which columns actually helped.
 */
export function rankFeatureSignals(args: {
  table: Table;
  schema: ColumnSchema[];
  target: string;
  task: "classification" | "regression";
  encodeRow: (row: unknown[], columns: ColumnSchema[]) => number[];
  maxFeatures?: number;
}): FeatureSignal[] {
  const { table, schema, target, task, encodeRow, maxFeatures = 6 } = args;
  void maxFeatures;
  const targetIdx = table.columns.findIndex((c) => c.name === target);
  if (targetIdx === -1) return [];
  const featureCols = schema.filter((c) => c.name !== target && usableAsFeature(c));
  if (featureCols.length === 0 || table.rows.length < 6) return [];

  const labeled = table.rows
    .map((row) => ({ row, y: row[targetIdx] }))
    .filter((r) => !isMissingTarget(r.y));
  if (labeled.length < 6) return [];

  const scores = featureCols.map((col) => ({
    name: col.name,
    score: singleFeatureSkill(
      labeled.map((r) => r.row),
      labeled.map((r) => r.y),
      [col],
      task,
      encodeRow,
    ),
  }));
  const best = Math.max(...scores.map((s) => s.score));
  if (!(best > 0)) return [];
  return scores
    .map((s) => ({ name: s.name, strength: round3(s.score / best) }))
    .sort((a, b) => b.strength - a.strength);
}

function usableAsFeature(col: ColumnSchema): boolean {
  return col.type !== "text";
}

function isMissingTarget(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "" || s === "na" || s === "n/a" || s === "null" || s === "none" || s === "nan" || s === "-" || s === "--" || s === "?";
  }
  return false;
}

/** Holdout skill of a 3-NN using only the given columns. Higher is better. */
function singleFeatureSkill(
  rows: unknown[][],
  targets: unknown[],
  cols: ColumnSchema[],
  task: "classification" | "regression",
  encodeRow: (row: unknown[], columns: ColumnSchema[]) => number[],
): number {
  const split = Math.floor(rows.length * 0.7);
  if (rows.length - split < 2) return 0;
  const trainRows = rows.slice(0, split);
  const trainY = targets.slice(0, split);
  const testRows = rows.slice(split);
  const testY = targets.slice(split);

  const encode = (row: unknown[]) => encodeRow(row, cols);
  const trainX = trainRows.map(encode);
  const testX = testRows.map(encode);
  if (trainX[0]!.length === 0) return 0;

  const preds = testX.map((x) => knnPredict(x, trainX, trainY, task));
  if (task === "classification") {
    let correct = 0;
    for (let i = 0; i < testY.length; i++) {
      if (String(preds[i]) === String(testY[i])) correct++;
    }
    // Skill above chance: how much better than random guessing.
    const classes = new Set(testY.map((v) => String(v))).size;
    const chance = classes <= 1 ? 1 : 1 / classes;
    return Math.max(0, correct / testY.length - chance);
  }
  const nums = testY.map(toNum).filter((n): n is number => n !== null);
  if (nums.length < 2) return 0;
  const predNums = preds.map((p) => (typeof p === "number" ? p : 0)).slice(0, nums.length);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  if (variance === 0) return 0;
  const mse = predNums.reduce((a, p, i) => a + (p - nums[i]!) ** 2, 0) / nums.length;
  // Variance explained, floored at 0.
  return Math.max(0, 1 - mse / variance);
}

function knnPredict(x: number[], trainX: number[][], trainY: unknown[], task: "classification" | "regression"): unknown {
  const k = Math.min(3, trainX.length);
  const dists = trainX.map((t, i) => ({ i, d: dist2(x, t) }));
  dists.sort((a, b) => a.d - b.d);
  const top = dists.slice(0, k).map((d) => trainY[d.i]);
  if (task === "regression") {
    const nums = top.map(toNum).filter((n): n is number => n !== null);
    if (nums.length === 0) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  const counts = new Map<string, { count: number; first: number }>();
  top.forEach((v, order) => {
    const key = String(v);
    const e = counts.get(key) ?? { count: 0, first: order };
    e.count++;
    counts.set(key, e);
  });
  let best = String(top[0]);
  let bestScore = -1;
  for (const [key, e] of counts) {
    const score = e.count * 1000 - e.first;
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    s += d * d;
  }
  return s;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
