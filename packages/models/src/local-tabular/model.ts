import { columnValues } from "@tavolio/table";
import { isMissingValue } from "@tavolio/preprocessing";
import type { Runtime } from "@tavolio/runtime";
import type {
  FeatureSignal,
  PrepareContext,
  PredictionResult,
  TavolioModel,
  Task,
} from "../types.js";
import { encodeFeatures, encodeRowSubset, isUsableFeature } from "./adapter.js";
import { LOCAL_TABULAR_MANIFEST } from "./manifest.js";

interface Prepared {
  ctx: PrepareContext;
  featureNames: string[];
  matrix: number[][];
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

function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    s += d * d;
  }
  return s;
}

/** Deterministic shuffle so held-out metrics are stable across runs. */
function shuffled<T>(arr: T[], seed = 42): T[] {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * local-tabular v1. A tiny transparent kNN baseline behind the TavolioModel
 * contract so the Sheets shell, pipeline, and tests work end-to-end (and the
 * "vs baseline" story in §6 is honest) before a real ONNX artifact lands.
 * Swap run() to call @tavolio/runtime once the artifact exists.
 */
export class LocalTabularModel implements TavolioModel {
  readonly manifest = LOCAL_TABULAR_MANIFEST;
  private loaded = false;

  constructor(private runtime?: Runtime) {
    void this.runtime;
  }

  async load(): Promise<void> {
    // TODO: fetch artifact via runtime cache, warm Onyx session.
    this.loaded = true;
  }

  async prepare(ctx: PrepareContext): Promise<Prepared> {
    const { frame } = encodeFeatures(
      { columns: ctx.schema.map((c) => ({ ...c })), rows: ctx.table.rows },
      ctx.schema,
      ctx.target,
    );
    void frame.rowMask;
    return { ctx, featureNames: frame.featureNames, matrix: frame.matrix };
  }

  async run(prepared: unknown): Promise<unknown> {
    if (!this.loaded) await this.load();
    // TODO: runtime.run({ model: this.manifest.artifact.uri, inputs }) -> tensors.
    return prepared;
  }

  async decode(outputs: unknown, ctx: PrepareContext): Promise<PredictionResult> {
    const prepared = outputs as Prepared;
    const targetValues = columnValues(ctx.table, ctx.target);

    const labeledIdx: number[] = [];
    const blankIdx: number[] = [];
    targetValues.forEach((v, i) => {
      if (isMissingValue(v)) blankIdx.push(i);
      else if (ctx.task.type === "classification" || toNum(v) !== null) labeledIdx.push(i);
      else blankIdx.push(i);
    });

    const trainX = labeledIdx.map((i) => prepared.matrix[i]!);
    const trainY = labeledIdx.map((i) => targetValues[i]);
    const width = prepared.matrix[0]?.length ?? 0;
    const hasFeatures = width > 0 && trainX.length > 0;
    const k = 3;

    const knnOne = (x: number[]): { value: unknown; confidence: number; probs?: number[] } => {
      if (!hasFeatures) return fallbackPrediction(ctx.task, trainY);
      const order = trainX
        .map((t, j) => ({ j, d: dist2(x, t) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.min(k, trainX.length));
      const top = order.map((o) => trainY[o.j]);
      if (ctx.task.type === "regression") {
        const nums = top.map(toNum).filter((v): v is number => v !== null);
        const pred = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        return { value: round4(pred), confidence: 1 };
      }
      const classes = ctx.task.classes;
      const counts = new Map<string, number>();
      for (const v of top) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      let best = String(top[0]);
      let bestCount = -1;
      for (const c of classes) {
        const cnt = counts.get(c) ?? 0;
        if (cnt > bestCount) {
          bestCount = cnt;
          best = c;
        }
      }
      const probs = classes.map((c) => round4((counts.get(c) ?? 0) / Math.max(1, top.length)));
      return { value: best, confidence: round4(bestCount / Math.max(1, top.length)), probs };
    };

    const perRow = prepared.matrix.map((x) => knnOne(x));
    const predictions = perRow.map((r) => r.value);
    const confidences = perRow.map((r) => r.confidence);
    const probabilities =
      ctx.task.type === "classification"
        ? perRow.map((r) => (ctx.task.type === "classification" ? (r.probs ?? ctx.task.classes.map(() => 0)) : []))
        : undefined;

    const evaluation = evaluateHoldoutSplit(ctx, prepared, labeledIdx);
    const featureSignals = rankSignals(ctx);
    const metrics: Record<string, number> = {};
    if (evaluation.kind === "classification") {
      metrics.accuracy = evaluation.accuracy ?? 0;
      metrics.baselineAccuracy = evaluation.baselineAccuracy ?? 0;
    } else {
      metrics.mae = evaluation.mae ?? 0;
      metrics.rmse = evaluation.rmse ?? 0;
      metrics.r2 = evaluation.r2 ?? 0;
      metrics.baselineMae = evaluation.baselineMae ?? 0;
    }

    const warnings = [
      `local-tabular-v1 kNN (k=${k}) on ${trainX.length} labeled rows, ${prepared.featureNames.length} encoded features — until the ONNX artifact lands.`,
    ];
    if (!hasFeatures) warnings.push("No usable feature columns — predictions fall back to majority class / mean target.");
    if (blankIdx.length > 0) {
      warnings.push(`${blankIdx.length} row${blankIdx.length === 1 ? "" : "s"} with a blank target will get fresh predictions.`);
    }
    return {
      task: ctx.task,
      target: ctx.target,
      predictions,
      probabilities,
      confidences,
      newRowIndexes: blankIdx,
      evaluation,
      featureSignals,
      metrics,
      warnings,
    };
  }

  async predict(
    table: Parameters<TavolioModel["predict"]>[0],
    target: string,
    task: Task,
  ): Promise<PredictionResult> {
    const ctx: PrepareContext = { table, schema: table.columns, target, task };
    const prepared = await this.prepare(ctx);
    const outputs = await this.run(prepared);
    return this.decode(outputs, ctx);
  }
}

function fallbackPrediction(task: Task, trainY: unknown[]): { value: unknown; confidence: number; probs?: number[] } {
  if (task.type === "regression") {
    const nums = trainY.map(toNum).filter((v): v is number => v !== null);
    const mean = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    return { value: round4(mean), confidence: 1 };
  }
  const counts = new Map<string, number>();
  for (const v of trainY) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  let best = task.classes[0]!;
  let bestCount = -1;
  for (const c of task.classes) {
    const cnt = counts.get(c) ?? 0;
    if (cnt > bestCount) {
      bestCount = cnt;
      best = c;
    }
  }
  const total = Math.max(1, trainY.length);
  return {
    value: best,
    confidence: round4(bestCount / total),
    probs: task.classes.map((c) => round4((counts.get(c) ?? 0) / total)),
  };
}

function evaluateHoldoutSplit(
  ctx: PrepareContext,
  prepared: Prepared,
  labeledIdx: number[],
): NonNullable<PredictionResult["evaluation"]> {
  const targetValues = columnValues(ctx.table, ctx.target);
  if (labeledIdx.length < 4) {
    return ctx.task.type === "classification"
      ? { kind: "classification", accuracy: 0, baselineAccuracy: 0 }
      : { kind: "regression", mae: 0, rmse: 0, r2: 0, baselineMae: 0 };
  }
  const order = shuffled(labeledIdx, 42);
  const split = Math.max(1, Math.floor(order.length * 0.7));
  const train = order.slice(0, split);
  const test = order.slice(split);
  const trainX = train.map((i) => prepared.matrix[i]!);
  const trainY = train.map((i) => targetValues[i]);
  const testX = test.map((i) => prepared.matrix[i]!);
  const testY = test.map((i) => targetValues[i]);
  const hasFeatures = (prepared.matrix[0]?.length ?? 0) > 0 && trainX.length > 0;
  const predictOne = (x: number[]): unknown => {
    if (!hasFeatures) return fallbackPrediction(ctx.task, trainY).value;
    const top = nearestTargets(x, trainX, trainY, 3);
    if (ctx.task.type === "regression") return meanOf(top);
    return majorityOf(top);
  };
  if (ctx.task.type === "classification") {
    const preds = testX.map(predictOne);
    let correct = 0;
    for (let i = 0; i < testY.length; i++) {
      if (String(preds[i]) === String(testY[i])) correct++;
    }
    const acc = testY.length === 0 ? 0 : correct / testY.length;
    const counts = new Map<string, number>();
    for (const v of testY) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const baseline = testY.length === 0 ? 0 : Math.max(...counts.values()) / testY.length;
    return { kind: "classification", accuracy: round4(acc), baselineAccuracy: round4(baseline) };
  }
  const preds = testX.map((x) => Number(predictOne(x)));
  const actual = testY.map((v) => toNum(v)!);
  const denom = Math.max(1, actual.length);
  const mae = actual.reduce((a, v, i) => a + Math.abs(v - preds[i]!), 0) / denom;
  const rmse = Math.sqrt(actual.reduce((a, v, i) => a + (v - preds[i]!) ** 2, 0) / denom);
  const mean = actual.reduce((a, b) => a + b, 0) / denom;
  const ssTot = actual.reduce((a, v) => a + (v - mean) ** 2, 0);
  const ssRes = actual.reduce((a, v, i) => a + (v - preds[i]!) ** 2, 0);
  const baselineMae = actual.reduce((a, v) => a + Math.abs(v - mean), 0) / denom;
  return {
    kind: "regression",
    mae: round4(mae),
    rmse: round4(rmse),
    r2: round4(ssTot === 0 ? 0 : 1 - ssRes / ssTot),
    baselineMae: round4(baselineMae),
  };
}

function nearestTargets(x: number[], trainX: number[][], trainY: unknown[], k: number): unknown[] {
  const order = trainX
    .map((t, j) => ({ j, d: dist2(x, t) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.min(k, trainX.length));
  return order.map((o) => trainY[o.j]);
}

function majorityOf(top: unknown[]): unknown {
  const counts = new Map<string, number>();
  for (const v of top) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  let best = String(top[0]);
  let bestCount = -1;
  for (const [key, cnt] of counts) {
    if (cnt > bestCount) {
      bestCount = cnt;
      best = key;
    }
  }
  return best;
}

function meanOf(top: unknown[]): number {
  const nums = top.map(toNum).filter((v): v is number => v !== null);
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function rankSignals(ctx: PrepareContext): FeatureSignal[] {
  const targetValues = columnValues(ctx.table, ctx.target);
  const labeled = ctx.table.rows
    .map((row, i) => ({ row, y: targetValues[i] }))
    .filter((r) => !isMissingValue(r.y));
  if (labeled.length < 6) return [];
  const candidates = ctx.schema.filter((c) => c.name !== ctx.target && isUsableFeature(c, ctx.table));
  if (candidates.length === 0) return [];
  const kind = ctx.task.type;
  const scored = candidates.map((col) => ({
    name: col.name,
    score: singleSkill(labeled.map((r) => r.row), labeled.map((r) => r.y), kind, singleCol(ctx, col.name)),
  }));
  const best = Math.max(...scored.map((s) => s.score));
  if (!(best > 0)) return [];
  return scored
    .map((s) => ({ name: s.name, strength: round3(s.score / best) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6);
}

function singleCol(
  ctx: PrepareContext,
  name: string,
): (row: unknown[]) => number[] {
  const col = ctx.schema.find((c) => c.name === name)!;
  return (row) => encodeRowSubset(ctx.table, ctx.schema, ctx.target, row, [col] as never);
}

function singleSkill(
  rows: unknown[][],
  targets: unknown[],
  task: "classification" | "regression",
  encode: (row: unknown[]) => number[],
): number {
  const split = Math.floor(rows.length * 0.7);
  if (rows.length - split < 2) return 0;
  const trainX = rows.slice(0, split).map(encode);
  const trainY = targets.slice(0, split);
  const testX = rows.slice(split).map(encode);
  const testY = targets.slice(split);
  if ((trainX[0]?.length ?? 0) === 0) return 0;
  const preds = testX.map((x) => {
    const top = nearestTargets(x, trainX, trainY, 3);
    if (task === "regression") return meanOf(top);
    return majorityOf(top);
  });
  if (task === "classification") {
    let correct = 0;
    for (let i = 0; i < testY.length; i++) {
      if (String(preds[i]) === String(testY[i])) correct++;
    }
    const classes = new Set(testY.map((v) => String(v))).size;
    const chance = classes <= 1 ? 1 : 1 / classes;
    return Math.max(0, correct / Math.max(1, testY.length) - chance);
  }
  const actual = testY.map(toNum).filter((v): v is number => v !== null);
  if (actual.length < 2) return 0;
  const predNums = (preds as number[]).slice(0, actual.length);
  const mean = actual.reduce((a, b) => a + b, 0) / actual.length;
  const variance = actual.reduce((a, b) => a + (b - mean) ** 2, 0) / actual.length;
  if (variance === 0) return 0;
  const mse = predNums.reduce((a, p, i) => a + (p - actual[i]!) ** 2, 0) / actual.length;
  return Math.max(0, 1 - mse / variance);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
