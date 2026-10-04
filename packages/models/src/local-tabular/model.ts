import { columnValues } from "@tavolio/table";
import { isMissingValue } from "@tavolio/preprocessing";
import type {
  FeatureSignal,
  PrepareContext,
  PredictionResult,
  TavolioModel,
  Task,
  ValidationStrategy,
} from "../types.js";
import { encodeFeatures } from "./adapter.js";
import { fitLinearRegression, fitLogisticRegression } from "../baseline.js";
import { LOCAL_TABULAR_MANIFEST } from "./manifest.js";

interface Prepared {
  ctx: PrepareContext;
  featureNames: string[];
  /** Per encoded column: the sheet column it came from. */
  source: string[];
  matrix: number[][];
}

export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Deterministic shuffle so held-out metrics are stable across runs. */
export function shuffled<T>(arr: T[], seed = 42): T[] {
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

/** What a fitted baseline says about one row. */
interface Guess {
  value: unknown;
  confidence: number;
  probs?: number[];
  /** Regression with an interval requested: the central interval around `value`. */
  bounds?: { lower: number; upper: number };
}

/** Standard normal quantile (Acklam's rational approximation), for turning an interval level into a z-score. */
export function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** A fitted ridge / logistic regression behind one interface. `y` is the class index (classification) or the number (regression). */
interface Learner {
  predict(rows: number[][]): Guess[];
  /** Per encoded column: how hard the model leans on it. */
  weights: number[];
}

function learn(task: Task, trainX: number[][], trainY: number[], interval?: number): Learner {
  if (task.type === "regression") {
    const fit = fitLinearRegression(trainX, trainY);
    // The interval is the prediction plus or minus z standard deviations of the model's own training residuals.
    let half = 0;
    if (interval !== undefined && trainY.length > 1) {
      const fitted = fit.predict(trainX);
      const sigma = Math.sqrt(fitted.reduce((a, v, i) => a + (v - trainY[i]!) ** 2, 0) / (trainY.length - 1));
      half = normalQuantile(1 - (1 - interval) / 2) * sigma;
    }
    return {
      predict: (rows) =>
        fit.predict(rows).map((v) => ({
          value: round4(v),
          confidence: 1,
          bounds: interval === undefined ? undefined : { lower: round4(v - half), upper: round4(v + half) },
        })),
      weights: fit.weights,
    };
  }
  const classes = task.classes;
  const fit = fitLogisticRegression(trainX, trainY, Math.max(1, classes.length));
  return {
    weights: fit.weights,
    predict: (rows) =>
      fit.proba(rows).map((p) => {
        const best = p.reduce((b, v, c) => (v > p[b]! ? c : b), 0);
        return { value: classes[best], confidence: round4(p[best]!), probs: p.map(round4) };
      }),
  };
}

/**
 * local-tabular v1: the plain reference model behind the TavolioModel contract. Ridge linear regression for numeric targets,
 * multinomial logistic regression for categorical ones (baseline.ts), on one-hot / imputed features. It is the fallback when
 * TabPFN can't run a table, and the only model for regression. Its column weights are its own explanation. No ML dependencies.
 */
export class LocalTabularModel implements TavolioModel {
  readonly manifest = LOCAL_TABULAR_MANIFEST;

  async load(): Promise<void> {
    // Nothing to fetch: the model is fitted from the table on every run.
  }

  async prepare(ctx: PrepareContext): Promise<Prepared> {
    const { frame } = encodeFeatures({ columns: ctx.schema.map((c) => ({ ...c })), rows: ctx.table.rows }, ctx.schema, ctx.target);
    return { ctx, featureNames: frame.featureNames, source: frame.source, matrix: frame.matrix };
  }

  async run(prepared: unknown): Promise<unknown> {
    return prepared;
  }

  async decode(outputs: unknown, ctx: PrepareContext): Promise<PredictionResult> {
    const prepared = outputs as Prepared;
    const { task } = ctx;
    const targetValues = columnValues(ctx.table, ctx.target);
    const classIndex = task.type === "classification" ? new Map(task.classes.map((c, i) => [c, i])) : null;
    /** Class index / number for a known target, null when it isn't usable. */
    const known = (v: unknown): number | null => {
      if (isMissingValue(v)) return null;
      if (classIndex) return classIndex.get(String(v)) ?? null;
      return toNum(v);
    };

    const labeled: number[] = [];
    const blank: number[] = [];
    const y = new Map<number, number>();
    targetValues.forEach((v, row) => {
      const k = known(v);
      if (k === null) blank.push(row);
      else {
        labeled.push(row);
        y.set(row, k);
      }
    });
    const fitOn = (rows: number[], interval?: number) => learn(task, rows.map((r) => prepared.matrix[r]!), rows.map((r) => y.get(r)!), interval);

    const warnings: string[] = [];
    const guesses = new Map<number, Guess>();
    let signalsFrom: Learner | null = null;
    if (blank.length > 0) {
      const learner = fitOn(labeled, ctx.interval);
      signalsFrom = learner;
      learner.predict(blank.map((r) => prepared.matrix[r]!)).forEach((g, i) => guesses.set(blank[i]!, g));
    } else {
      // Nothing to fill, so every row gets a prediction made without seeing its own label (3-fold out-of-fold).
      const folds = 3;
      const order = shuffled(labeled, 7);
      for (let f = 0; f < folds; f++) {
        const test = order.filter((_, i) => i % folds === f);
        const train = order.filter((_, i) => i % folds !== f);
        if (test.length === 0 || train.length === 0) continue;
        const learner = fitOn(train, ctx.interval);
        signalsFrom ??= learner;
        learner.predict(test.map((r) => prepared.matrix[r]!)).forEach((g, i) => guesses.set(test[i]!, g));
      }
      warnings.push("There were no blank cells to fill, so each row was predicted from the other rows.");
    }

    const predictions: unknown[] = new Array(targetValues.length);
    const intervals: Array<{ lower: number; upper: number } | null> = new Array(targetValues.length).fill(null);
    const confidences: number[] = new Array(targetValues.length);
    const probabilities: number[][] | undefined = classIndex ? new Array(targetValues.length) : undefined;
    for (let r = 0; r < targetValues.length; r++) {
      const guess = guesses.get(r);
      if (guess) {
        predictions[r] = guess.value;
        if (guess.bounds) intervals[r] = guess.bounds;
        confidences[r] = guess.confidence;
        if (probabilities) probabilities[r] = guess.probs!;
      } else {
        // Rows whose target is known keep it; the UI only writes predictions for the rows that needed one.
        const k = y.get(r);
        predictions[r] = k === undefined ? null : classIndex ? (task as Extract<Task, { type: "classification" }>).classes[k] : k;
        confidences[r] = 1;
        if (probabilities) probabilities[r] = (task as Extract<Task, { type: "classification" }>).classes.map((_, c) => (c === k ? 1 : 0));
      }
    }

    const validation = ctx.validation ?? { kind: "random" };
    let evaluation: PredictionResult["evaluation"];
    if (validation.kind !== "none") {
      const split = holdoutSplit(labeled, validation);
      if (split) {
        if (ctx.baseline !== false) await ctx.onBaseline?.();
        evaluation = evaluate(task, split, (rows) => fitOn(rows), prepared.matrix, y, ctx.baseline !== false);
      } else if (validation.kind === "selection") {
        const chosen = new Set(validation.rows);
        warnings.push(
          labeled.some((i) => chosen.has(i))
            ? "Every labeled row was selected, so there was nothing left to learn from for the accuracy check."
            : "None of the selected rows have a known target, so accuracy couldn't be measured.",
        );
      }
    }
    const metrics: Record<string, number> = {};
    if (evaluation?.kind === "classification") {
      metrics.accuracy = evaluation.accuracy ?? 0;
      if (evaluation.baselineAccuracy !== undefined) metrics.baselineAccuracy = evaluation.baselineAccuracy;
    } else if (evaluation) {
      metrics.mae = evaluation.mae ?? 0;
      metrics.rmse = evaluation.rmse ?? 0;
      metrics.r2 = evaluation.r2 ?? 0;
      if (evaluation.baselineMae !== undefined) metrics.baselineMae = evaluation.baselineMae;
    }

    warnings.unshift(
      `${task.type === "regression" ? "Ridge linear regression" : "Logistic regression"} on ${labeled.length} labeled rows, ${prepared.featureNames.length} encoded features.`,
    );
    if (prepared.featureNames.length === 0) warnings.push("No usable feature columns, so predictions fall back to the most common value / the average.");
    if (blank.length > 0) warnings.push(`${blank.length} row${blank.length === 1 ? "" : "s"} with a blank target will get fresh predictions.`);

    return {
      task,
      target: ctx.target,
      predictions,
      probabilities,
      confidences,
      intervals: task.type === "regression" && ctx.interval !== undefined ? intervals : undefined,
      intervalLevel: task.type === "regression" ? ctx.interval : undefined,
      newRowIndexes: blank,
      evaluation,
      validation: validation.kind,
      featureSignals: signalsFrom ? columnWeights(prepared.source, signalsFrom.weights) : [],
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
    return this.decode(await this.run(await this.prepare(ctx)), ctx);
  }
}

/** The model's own weights per sheet column (a category's one-hot weights add up), scaled to the biggest. */
function columnWeights(source: string[], weights: number[]): FeatureSignal[] {
  const total = new Map<string, number>();
  source.forEach((name, j) => total.set(name, (total.get(name) ?? 0) + (weights[j] ?? 0)));
  const top = Math.max(0, ...total.values());
  if (!(top > 0)) return [];
  return [...total]
    .map(([name, w]) => ({ name, strength: round3(w / top) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6);
}

/** Same split rules whichever model runs, so "quality" means the same thing. */
function holdoutSplit(
  labeled: number[],
  validation: Exclude<ValidationStrategy, { kind: "none" }>,
): { train: number[]; test: number[] } | null {
  if (validation.kind === "selection") {
    const chosen = new Set(validation.rows);
    const test = labeled.filter((i) => chosen.has(i));
    const train = labeled.filter((i) => !chosen.has(i));
    return test.length === 0 || train.length === 0 ? null : { train, test };
  }
  if (labeled.length < 4) return null;
  const order = shuffled(labeled, 42);
  const fraction = Math.min(0.9, Math.max(0.05, validation.testFraction ?? 0.3));
  const split = Math.min(order.length - 1, Math.max(1, Math.round(order.length * (1 - fraction))));
  return { train: order.slice(0, split), test: order.slice(split) };
}

/** Held-out score against the dumbest guess: always the most common value (classification) or always the average (regression). */
function evaluate(
  task: Task,
  split: { train: number[]; test: number[] },
  fitOn: (rows: number[]) => Learner,
  matrix: number[][],
  y: Map<number, number>,
  withBaseline: boolean,
): NonNullable<PredictionResult["evaluation"]> {
  const { train, test } = split;
  const guesses = fitOn(train).predict(test.map((r) => matrix[r]!));
  const actual = test.map((r) => y.get(r)!);
  const n = Math.max(1, actual.length);
  if (task.type === "classification") {
    const counts = new Map<number, number>();
    for (const r of train) counts.set(y.get(r)!, (counts.get(y.get(r)!) ?? 0) + 1);
    const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const right = actual.filter((c, i) => task.classes[c] === guesses[i]!.value).length;
    const accuracy = round4(right / n);
    return withBaseline
      ? { kind: "classification", accuracy, baselineAccuracy: round4(actual.filter((c) => c === common).length / n), baselineKind: "majority" }
      : { kind: "classification", accuracy };
  }
  const preds = guesses.map((g) => Number(g.value));
  const mean = train.reduce((a, r) => a + y.get(r)!, 0) / Math.max(1, train.length);
  const mae = actual.reduce((a, v, i) => a + Math.abs(v - preds[i]!), 0) / n;
  const rmse = Math.sqrt(actual.reduce((a, v, i) => a + (v - preds[i]!) ** 2, 0) / n);
  const centre = actual.reduce((a, b) => a + b, 0) / n;
  const ssTot = actual.reduce((a, v) => a + (v - centre) ** 2, 0);
  const ssRes = actual.reduce((a, v, i) => a + (v - preds[i]!) ** 2, 0);
  return {
    kind: "regression",
    mae: round4(mae),
    rmse: round4(rmse),
    r2: round4(ssTot === 0 ? 0 : 1 - ssRes / ssTot),
    ...(withBaseline ? { baselineMae: round4(actual.reduce((a, v) => a + Math.abs(v - mean), 0) / n), baselineKind: "mean" as const } : {}),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
