import { columnValues } from "@tavolio/table";
import { isMissingValue } from "@tavolio/preprocessing";
import type {
  LoadHint,
  LoadProgress,
  ModelManifest,
  FeatureSignal,
  PredictionResult,
  RowExplanation,
  PrepareContext,
  TavolioModel,
  Task,
  ValidationStrategy,
} from "../types.js";
import { linearRegressionPredict, logisticRegressionPredict } from "../baseline.js";
import { identityShap, type ShapKnown, type ShapQuery } from "../explain.js";
import { encodeFeatures } from "../local-tabular/adapter.js";
import { shuffled } from "../local-tabular/model.js";
import { TABPFN_MAX_CLASSES, type TabPfnInput, type TabPfnOutput } from "./classifier.js";
import type { TabPfnRegressionInput, TabPfnRegressionOutput } from "./regressor.js";
import { encodeForTabPfn, TABPFN_MAX_FEATURES, type TabPfnFrame } from "./encode.js";
import { buildTabPfnInputs } from "./inputs.js";

export const TABPFN_FAST_MANIFEST: ModelManifest & { artifact: NonNullable<ModelManifest["artifact"]> } = {
  id: "tabpfn-fast-v1",
  displayName: "TabPFN Fast",
  version: "3.5.0-alpha",
  taskKinds: ["classification", "regression"],
  artifact: { uri: "models/tabpfn_fast_client.onnx", format: "onnx" },
  preferredRuntime: "webgpu",
};

/** The regression graph is a separate file: the two heads and target encoders are different, so each task downloads only its own. */
export const TABPFN_FAST_REGRESSION_URI = "models/tabpfn_fast_reg_client.onnx";

export type TabPfnTaskKind = "classification" | "regression";

/** What the model needs from an inference engine; `TabPfnClassifier` / `TabPfnRegressor` implement it. */
export interface TabPfnPredictor {
  predictProba(input: TabPfnInput): Promise<TabPfnOutput>;
  /** Absent when the engine has no regression graph; regression then falls back. */
  predictMean?(input: TabPfnRegressionInput): Promise<TabPfnRegressionOutput>;
}

export interface TabPfnModelOptions {
  predictor: TabPfnPredictor;
  /** Identity shown in the UI and the registry. Default: TabPFN Fast, on this device. */
  manifest?: ModelManifest;
  /**
   * Make the engine ready (download/cache the model, create the session). Resolve `null` when ready, or a short reason this
   * device can't run it ("this browser has no WebGPU"); the model then falls back. Called by `load`.
   */
  ensureReady?: (onProgress: ((p: LoadProgress) => void) | undefined, task: TabPfnTaskKind) => Promise<string | null>;
  /** Used for too many classes, tables TabPFN can't take, and any engine failure. */
  fallback: TavolioModel;
  /** Labeled rows given to the model as context; more are subsampled. Default 5000. */
  maxContextRows?: number;
  /** Test rows per model call. Default 2000. */
  chunkRows?: number;
}

interface Prepared {
  ctx: PrepareContext;
  /** Set when TabPFN can't or shouldn't handle this table; `decode` then runs the fallback. */
  fallbackReason?: string;
  frame?: TabPfnFrame;
  regression: boolean;
  classes: string[];
  /** Rows with a known target, and each one's class index (classification). */
  labeled: number[];
  labelOf: Map<number, number>;
  /** Each labeled row's target value (regression). */
  valueOf: Map<number, number>;
  /** Rows with a blank target: these get fresh predictions. */
  blank: number[];
}

interface Outputs {
  prepared: Prepared;
  /** Held-out evaluation: model probabilities for `test` given `train` as context. */
  evalRun?: { train: number[]; test: number[]; probs: Float64Array };
  /** Per row that receives a prediction: its class probabilities, or (regression) the one predicted number. */
  rowProbs: Map<number, Float64Array>;
  /** Regression with an interval requested: per predicted row, the interval bounds. */
  rowBounds: Map<number, { lower: number; upper: number }>;
  /** The predicted rows the column ranking draws from and the context they are explained against (never containing those rows). */
  explainPlan?: { rows: number[]; train: number[] };
  notes: string[];
}

type Bounds = { lower: Float64Array; upper: Float64Array };
const newBounds = (n: number): Bounds => ({ lower: new Float64Array(n), upper: new Float64Array(n) });

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Rows explained for the column ranking, and rows explained per pass for the rest. */
const EXPLAIN_ROWS = 24;
const EXPLAIN_CHUNK = 100;

function concatFloat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function argmax(p: ArrayLike<number>, from = 0, len = p.length): number {
  let best = 0;
  for (let i = 1; i < len; i++) if (p[from + i]! > p[from + best]!) best = i;
  return best;
}

/** Same split rules as the linear baseline so "quality" means the same thing whichever model runs. */
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

/**
 * TabPFN-3.5-Fast behind the TavolioModel contract: classification and regression, each through its own exported graph.
 * Everything else (>64 classes, no usable device, any runtime failure) falls back to the baseline, with the reason
 * in the result's warnings, so a run always produces something honest.
 */
export class TabPfnModel implements TavolioModel {
  readonly manifest: ModelManifest;
  private ready = new Map<TabPfnTaskKind, Promise<string | null>>();
  private failed = new Set<TabPfnTaskKind>();
  /** f(empty) per run, for explanations against the full labeled context (the answer doesn't depend on which rows are explained). */
  private emptyAnswers = new WeakMap<Prepared, ArrayLike<number>>();
  /** Explanations run one at a time: the column ranking starts in the background and a clicked row shouldn't compete with it for the session. */
  private lane: Promise<unknown> = Promise.resolve();

  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const result = this.lane.then(job, job);
    this.lane = result.catch(() => undefined);
    return result;
  }

  constructor(private readonly options: TabPfnModelOptions) {
    this.manifest = options.manifest ?? TABPFN_FAST_MANIFEST;
  }

  async load(onProgress?: (p: LoadProgress) => void, hint?: LoadHint): Promise<void> {
    // Will delegate to the baseline anyway: don't download for nothing.
    if (hint && hint.task.type === "classification" && hint.task.classes.length > TABPFN_MAX_CLASSES) return;
    if (hint?.task.type === "regression" && !this.options.predictor.predictMean) return;
    const kind = hint?.task.type ?? "classification";
    // A failure is remembered so `run` doesn't retry the same download in one request, but each new load is a fresh attempt.
    if (this.failed.has(kind)) this.ready.delete(kind);
    await this.ensureReady(kind, onProgress);
  }

  /** Resolves null when usable, else why not. Memoized for the request; `load` clears a failure so a transient download error retries next run. */
  private ensureReady(kind: TabPfnTaskKind, onProgress?: (p: LoadProgress) => void): Promise<string | null> {
    let ready = this.ready.get(kind);
    if (!ready) {
      ready = (async () => {
        try {
          return (await this.options.ensureReady?.(onProgress, kind)) ?? null;
        } catch (e) {
          console.error("[tavolio] TabPFN failed to start", e);
          return `it couldn't start (${e instanceof Error ? e.message : String(e)})`;
        }
      })().then((reason) => {
        if (reason !== null) this.failed.add(kind);
        else this.failed.delete(kind);
        return reason;
      });
      this.ready.set(kind, ready);
    }
    return ready;
  }

  async prepare(ctx: PrepareContext): Promise<Prepared> {
    const regression = ctx.task.type === "regression";
    const empty = {
      ctx,
      regression,
      classes: [] as string[],
      labeled: [] as number[],
      labelOf: new Map<number, number>(),
      valueOf: new Map<number, number>(),
      blank: [] as number[],
    };
    if (regression) return this.prepareRegression(ctx, empty);
    const classes = (ctx.task as Extract<Task, { type: "classification" }>).classes;
    if (classes.length > TABPFN_MAX_CLASSES) {
      return { ...empty, classes, fallbackReason: `it handles up to ${TABPFN_MAX_CLASSES} outcomes and this column has ${classes.length}` };
    }
    const frame = encodeForTabPfn(ctx.table, ctx.schema, ctx.target);
    if (frame.cols === 0) return { ...empty, classes, fallbackReason: "there are no usable input columns" };

    const classIndex = new Map(classes.map((c, i) => [c, i]));
    const labeled: number[] = [];
    const blank: number[] = [];
    const labelOf = new Map<number, number>();
    columnValues(ctx.table, ctx.target).forEach((v, row) => {
      if (isMissingValue(v)) blank.push(row);
      else if (classIndex.has(String(v))) {
        labeled.push(row);
        labelOf.set(row, classIndex.get(String(v))!);
      }
    });
    if (labeled.length < 4) return { ...empty, classes, frame, blank, fallbackReason: "there are too few labeled rows" };
    return { ...empty, frame, classes, labeled, labelOf, blank };
  }

  private prepareRegression(ctx: PrepareContext, empty: Omit<Prepared, "frame" | "fallbackReason">): Prepared {
    if (!this.options.predictor.predictMean) return { ...empty, fallbackReason: "this device has no regression model" };
    const frame = encodeForTabPfn(ctx.table, ctx.schema, ctx.target);
    if (frame.cols === 0) return { ...empty, fallbackReason: "there are no usable input columns" };
    const labeled: number[] = [];
    const blank: number[] = [];
    const valueOf = new Map<number, number>();
    columnValues(ctx.table, ctx.target).forEach((v, row) => {
      if (isMissingValue(v)) blank.push(row);
      else if (typeof v === "number" ? Number.isFinite(v) : String(v).trim() !== "" && Number.isFinite(Number(v))) {
        labeled.push(row);
        valueOf.set(row, Number(v));
      }
    });
    if (labeled.length < 4) return { ...empty, frame, blank, fallbackReason: "there are too few labeled rows" };
    return { ...empty, frame, labeled, valueOf, blank };
  }

  async run(prepared: unknown): Promise<unknown> {
    const p = prepared as Prepared;
    if (p.fallbackReason) return p;
    const unavailable = await this.ensureReady(p.regression ? "regression" : "classification");
    if (unavailable) return { ...p, fallbackReason: unavailable } satisfies Prepared;
    try {
      return await this.execute(p);
    } catch (e) {
      console.error("[tavolio] TabPFN run failed", e);
      return { ...p, fallbackReason: `it failed while running (${e instanceof Error ? e.message : String(e)})` } satisfies Prepared;
    }
  }

  private async execute(p: Prepared): Promise<Outputs> {
    const { ctx, labeled, blank } = p;
    const k = p.regression ? 1 : p.classes.length;
    const out: Outputs = { prepared: p, rowProbs: new Map(), rowBounds: new Map(), notes: [] };
    const wantBounds = p.regression && ctx.interval !== undefined;
    const validation = ctx.validation ?? { kind: "random" };

    if (validation.kind !== "none") {
      const split = holdoutSplit(labeled, validation);
      if (split) out.evalRun = { ...split, probs: await this.predictRows(p, split.train, split.test) };
    }

    if (blank.length > 0) {
      // Explanations are for the rows that get predictions, whether or not an accuracy check ran.
      out.explainPlan = { rows: blank, train: labeled };
      const bounds = wantBounds ? newBounds(blank.length) : undefined;
      const probs = await this.predictRows(p, labeled, blank, p.frame!, bounds);
      blank.forEach((row, i) => {
        out.rowProbs.set(row, probs.slice(i * k, (i + 1) * k));
        if (bounds) out.rowBounds.set(row, { lower: bounds.lower[i]!, upper: bounds.upper[i]! });
      });
    } else {
      // Nothing to fill, so every row gets a prediction: made without seeing its own label (3-fold out-of-fold).
      const folds = 3;
      const order = shuffled(labeled, 7);
      for (let f = 0; f < folds; f++) {
        const test = order.filter((_, i) => i % folds === f);
        const train = order.filter((_, i) => i % folds !== f);
        if (test.length === 0 || train.length === 0) continue;
        out.explainPlan ??= { rows: test, train };
        const bounds = wantBounds ? newBounds(test.length) : undefined;
        const probs = await this.predictRows(p, train, test, p.frame!, bounds);
        test.forEach((row, i) => {
          out.rowProbs.set(row, probs.slice(i * k, (i + 1) * k));
          if (bounds) out.rowBounds.set(row, { lower: bounds.lower[i]!, upper: bounds.upper[i]! });
        });
      }
      out.notes.push("There were no blank cells to fill, so each row was predicted from the other rows.");
    }
    return out;
  }

  /** Probabilities (testRows × classes), or for regression the predicted value per row, for `test` rows with `train` rows as the in-context examples. */
  private async predictRows(p: Prepared, train: number[], test: number[], frame: TabPfnFrame = p.frame!, bounds?: Bounds): Promise<Float64Array> {
    const k = p.regression ? 1 : p.classes.length;
    const maxContext = this.options.maxContextRows ?? 5000;
    const chunk = this.options.chunkRows ?? 2000;
    const context = train.length > maxContext ? shuffled(train, 11).slice(0, maxContext) : train;
    const trainY = context.map((row) => (p.regression ? p.valueOf : p.labelOf).get(row)!);

    // Preprocessing is fitted on the context rows, so it is rebuilt for every call; test rows only go through it.
    const probs = new Float64Array(test.length * k);
    for (let start = 0; start < test.length; start += chunk) {
      const rows = test.slice(start, start + chunk);
      const { cols, trainX, testX } = buildTabPfnInputs(frame, context, rows);
      if (p.regression) {
        const { means, lower, upper } = await this.options.predictor.predictMean!({ cols, trainX, trainY, testX, interval: bounds ? p.ctx.interval : undefined });
        probs.set(means, start);
        if (bounds && lower && upper) {
          bounds.lower.set(lower, start);
          bounds.upper.set(upper, start);
        }
      } else {
        const { probabilities } = await this.options.predictor.predictProba({ cols, trainX, trainY, testX, numClasses: k });
        probs.set(probabilities, start * k);
      }
    }
    return probs;
  }

  async decode(outputs: unknown, ctx: PrepareContext): Promise<PredictionResult> {
    const base = outputs as Prepared | Outputs;
    const prepared = "prepared" in base ? base.prepared : base;
    if (!("prepared" in base)) return this.decodeFallback(prepared, ctx);

    const { classes, labelOf, blank } = prepared;
    const k = classes.length;
    const regression = prepared.regression;
    const rows = ctx.table.rows.length;
    const predictions: unknown[] = new Array(rows);
    const confidences: number[] = new Array(rows);
    const probabilities: number[][] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      const probs = base.rowProbs.get(r);
      if (regression) {
        // Rows whose target is known keep it; the UI only writes predictions for the rows that needed one.
        predictions[r] = probs ? probs[0]! : (prepared.valueOf.get(r) ?? null);
        confidences[r] = 1;
      } else if (probs) {
        const best = argmax(probs);
        predictions[r] = classes[best];
        confidences[r] = round4(probs[best]!);
        probabilities[r] = Array.from(probs, round4);
      } else {
        // Rows whose label is known keep it; the UI only writes predictions for the rows that needed one.
        const known = labelOf.get(r);
        predictions[r] = known === undefined ? null : classes[known];
        confidences[r] = 1;
        probabilities[r] = classes.map((_, c) => (c === known ? 1 : 0));
      }
    }

    const frame = prepared.frame!;
    const warnings = [...base.notes, ...frame.notes];
    if (frame.truncated) warnings.push(`Only the first ${TABPFN_MAX_FEATURES} usable columns were used.`);
    if (prepared.labeled.length > (this.options.maxContextRows ?? 5000)) {
      warnings.push(`Learned from a random ${this.options.maxContextRows ?? 5000} of ${prepared.labeled.length} labeled rows to keep this fast.`);
    }
    if (blank.length > 0) warnings.push(`${blank.length} row${blank.length === 1 ? "" : "s"} with a blank target will get fresh predictions.`);

    // Column signals come only from an explanation: there is no cheap stand-in worth showing for a model this different.
    // The ranking is worked out here, while the run is still "evaluating", so it arrives with the result.
    let featureSignals: FeatureSignal[] | undefined;
    let explanation: PredictionResult["explanation"];
    let explainRow: PredictionResult["explainRow"];
    let explainRows: PredictionResult["explainRows"];
    if (ctx.explain && base.explainPlan) {
      explainRows = (rows) => this.explainMany(prepared, rows, base.rowProbs);
      const cache = new Map<number, Promise<RowExplanation>>();
      explainRow = (row) => {
        let hit = cache.get(row);
        if (!hit) cache.set(row, (hit = this.explainOne(prepared, row, base.rowProbs)));
        hit.catch(() => cache.delete(row));
        return hit;
      };
      try {
        const explained = await this.explain(prepared, base.explainPlan, base.rowProbs);
        if (explained.signals.length > 0) {
          featureSignals = explained.signals;
          explanation = { method: "identity-shap", rows: explained.rows, evaluations: explained.evaluations };
        } else warnings.push("The explanation found no column that moved the predictions, so no column ranking is shown.");
      } catch (e) {
        console.error("[tavolio] explanation failed", e);
        warnings.push(`The explanation couldn't be computed (${e instanceof Error ? e.message : String(e)}), so no column ranking is shown.`);
      }
    }
    let evaluation: PredictionResult["evaluation"];
    const metrics: Record<string, number> = {};
    const validation = ctx.validation ?? { kind: "random" };
    if (base.evalRun && regression) {
      const { train, test, probs } = base.evalRun;
      // Reference: ridge linear regression on the same train/test rows (skipped when the baseline is turned off).
      let refPreds: number[] | null = null;
      if (ctx.baseline !== false) {
        await ctx.onBaseline?.();
        const { matrix } = encodeFeatures({ columns: ctx.schema.map((c) => ({ ...c })), rows: ctx.table.rows }, ctx.schema, ctx.target).frame;
        refPreds = linearRegressionPredict(
          train.map((r) => matrix[r]!),
          train.map((r) => prepared.valueOf.get(r)!),
          test.map((r) => matrix[r]!),
        );
      }
      const actual = test.map((r) => prepared.valueOf.get(r)!);
      const n = Math.max(1, actual.length);
      const centre = actual.reduce((a, b) => a + b, 0) / n;
      const ssTot = actual.reduce((a, v) => a + (v - centre) ** 2, 0);
      const ssRes = actual.reduce((a, v, i) => a + (v - probs[i]!) ** 2, 0);
      evaluation = {
        kind: "regression",
        mae: round4(actual.reduce((a, v, i) => a + Math.abs(v - probs[i]!), 0) / n),
        rmse: round4(Math.sqrt(ssRes / n)),
        r2: round4(ssTot === 0 ? 0 : 1 - ssRes / ssTot),
        ...(refPreds ? { baselineMae: round4(actual.reduce((a, v, i) => a + Math.abs(v - refPreds![i]!), 0) / n) } : {}),
      };
      metrics.mae = evaluation.mae!;
      metrics.rmse = evaluation.rmse!;
      metrics.r2 = evaluation.r2!;
      if (evaluation.baselineMae !== undefined) metrics.baselineMae = evaluation.baselineMae;
    } else if (base.evalRun) {
      const { test, probs } = base.evalRun;
      let correct = 0;
      // Reference: logistic regression on the same train/test rows (skipped when the baseline is turned off).
      let refPreds: ArrayLike<number> | null = null;
      if (ctx.baseline !== false) {
        await ctx.onBaseline?.();
        const { matrix } = encodeFeatures({ columns: ctx.schema.map((c) => ({ ...c })), rows: ctx.table.rows }, ctx.schema, ctx.target).frame;
        refPreds = logisticRegressionPredict(
          base.evalRun.train.map((r) => matrix[r]!),
          base.evalRun.train.map((r) => labelOf.get(r)!),
          test.map((r) => matrix[r]!),
          k,
        );
      }
      let refCorrect = 0;
      test.forEach((row, i) => {
        const truth = labelOf.get(row)!;
        if (argmax(probs, i * k, k) === truth) correct++;
        if (refPreds && refPreds[i] === truth) refCorrect++;
      });
      evaluation = {
        kind: "classification",
        accuracy: round4(correct / test.length),
        ...(refPreds ? { baselineAccuracy: round4(refCorrect / test.length) } : {}),
      };
      metrics.accuracy = evaluation.accuracy!;
      if (evaluation.baselineAccuracy !== undefined) metrics.baselineAccuracy = evaluation.baselineAccuracy;
    } else if (validation.kind === "selection") {
      const chosen = new Set(validation.rows);
      const held = prepared.labeled.filter((i) => chosen.has(i)).length;
      warnings.push(
        held === 0
          ? "None of the selected rows have a known target, so accuracy couldn't be measured."
          : "Every labeled row was selected, so there was nothing left to learn from for the accuracy check.",
      );
    }

    return {
      task: ctx.task,
      target: ctx.target,
      predictions,
      probabilities: regression ? undefined : probabilities,
      intervals: regression && ctx.interval !== undefined ? Array.from({ length: rows }, (_, r) => base.rowBounds.get(r) ?? null) : undefined,
      intervalLevel: regression && ctx.interval !== undefined ? ctx.interval : undefined,
      confidences,
      newRowIndexes: blank,
      evaluation,
      validation: validation.kind,
      featureSignals,
      explanation,
      explainRow,
      explainRows,
      metrics,
      model: { id: this.manifest.id, displayName: this.manifest.displayName },
      warnings,
    };
  }

  /**
   * Identity-coalition Shapley values (see explain.ts) for `rows`, against `context` rows (which must not include them). A
   * column is "absent" when its cell is left empty (NaN, which the model reads as missing); a row with one column present is
   * the same question for every row sharing that value, so those are asked once. The class explained is the predicted one (the
   * full row picks it). Everything goes through `predictRows`, so the hosted and the on-device predictor give the same
   * explanation. `phi` is in probability units (regression: the target's own units) and sums exactly to final - base.
   */
  private async shapley(p: Prepared, rows: number[], fullContext: number[], predicted?: Map<number, Float64Array>) {
    const frame = p.frame!;
    const k = p.regression ? 1 : p.classes.length;
    const features = [...new Set(frame.source)];
    const colsOf = features.map((name) => frame.source.flatMap((s, j) => (s === name ? [j] : [])));
    const maxContext = this.options.maxContextRows ?? 5000;
    const context = fullContext.length > maxContext ? shuffled(fullContext, 11).slice(0, maxContext) : fullContext;
    const nRows = frame.matrix.length / frame.cols;

    // Against every labeled row, which is also what the run predicted blank rows from (same rows, same sampling): a blank row's
    // full answer is its prediction, so the waterfall ends exactly on the number shown, and the empty answer is the same for all.
    const sameContext = fullContext.length === p.labeled.length;
    const known: ShapKnown | undefined = sameContext
      ? { base: this.emptyAnswers.get(p), final: (i) => predicted?.get(rows[i]!) }
      : undefined;

    const shap = await this.exclusive(() => identityShap({
      rows: rows.length,
      features: features.length,
      outputs: k,
      key: (row, f) => colsOf[f]!.map((j) => frame.matrix[rows[row]! * frame.cols + j]).join(","),
      value: async (queries: ShapQuery[]) => {
        const synthetic = new Float32Array(queries.length * frame.cols).fill(NaN);
        const own = (q: ShapQuery) => rows[q.row]! * frame.cols;
        queries.forEach((q, i) => {
          features.forEach((_, f) => {
            if (!q.present[f]) return;
            for (const j of colsOf[f]!) synthetic[i * frame.cols + j] = frame.matrix[own(q) + j]!;
          });
        });
        const extended: TabPfnFrame = { ...frame, matrix: concatFloat(frame.matrix, synthetic) };
        return this.predictRows(p, context, Array.from({ length: queries.length }, (_, i) => nRows + i), extended);
      },
      known,
    }));
    if (sameContext) this.emptyAnswers.set(p, shap.empty);
    return { features, phi: shap.phi, outcome: shap.outcome, final: shap.final, evaluations: shap.evaluations };
  }

  /** Which columns move the predictions: mean |Shapley value| over rows the model hadn't seen, scaled to the top for the bar widths. */
  private async explain(p: Prepared, plan: { rows: number[]; train: number[] }, predicted: Map<number, Float64Array>): Promise<{ signals: FeatureSignal[]; rows: number; evaluations: number }> {
    const rows = shuffled(plan.rows, 3).slice(0, EXPLAIN_ROWS);
    const { features, phi, evaluations } = await this.shapley(p, rows, plan.train, predicted);
    const impact = features.map((_, f) => phi.reduce((a, row) => a + Math.abs(row[f]!), 0) / Math.max(1, phi.length));
    const top = Math.max(...impact);
    const signals = top > 0
      ? features
          .map((name, f) => {
            const col = phi.map((row) => Math.abs(row[f]!));
            const mean = col.reduce((a, b) => a + b, 0) / Math.max(1, col.length);
            const std = Math.sqrt(col.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, col.length));
            return {
              name,
              strength: Math.round((impact[f]! / top) * 1000) / 1000,
              impact: round4(impact[f]!),
              spread: { min: round4(Math.min(...col)), max: round4(Math.max(...col)), std: round4(std) },
            };
          })
          .sort((a, b) => b.strength - a.strength)
      : [];
    return { signals, rows: rows.length, evaluations };
  }

  /** One row against every other labeled row, as the model itself predicts blank rows; biggest push first. */
  private async explainOne(p: Prepared, row: number, predicted: Map<number, Float64Array>): Promise<RowExplanation> {
    const [e] = await this.explainMany(p, [row], predicted);
    return { ...e!, contributions: [...e!.contributions].sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi)) };
  }

  /** Every row in `rows` against the labeled rows that aren't among them, a chunk at a time to bound memory. Works for both tasks. */
  private async explainMany(p: Prepared, rows: number[], predicted: Map<number, Float64Array>): Promise<RowExplanation[]> {
    const bad = rows.find((r) => !Number.isInteger(r) || r < 0 || r >= p.ctx.table.rows.length);
    if (bad !== undefined) throw new Error(`There is no row ${bad + 1}.`);
    const unavailable = await this.ensureReady(p.regression ? "regression" : "classification");
    if (unavailable) throw new Error(`${this.manifest.displayName} isn't available: ${unavailable}.`);
    const out: RowExplanation[] = [];
    for (let i = 0; i < rows.length; i += EXPLAIN_CHUNK) {
      const chunk = rows.slice(i, i + EXPLAIN_CHUNK);
      const inChunk = new Set(chunk);
      const { features, phi, outcome, final } = await this.shapley(p, chunk, p.labeled.filter((r) => !inChunk.has(r)), predicted);
      chunk.forEach((row, j) => {
        const total = phi[j]!.reduce((a, b) => a + b, 0);
        out.push({
          row,
          outcome: p.regression ? p.ctx.target : p.classes[outcome[j]!]!,
          base: round4(final[j]! - total),
          final: round4(final[j]!),
          contributions: features.map((name, f) => ({ name, phi: phi[j]![f]! })),
        });
      });
    }
    return out;
  }

  private async decodeFallback(prepared: Prepared, ctx: PrepareContext): Promise<PredictionResult> {
    const fb = this.options.fallback;
    const result = await fb.decode(await fb.run(await fb.prepare(ctx)), ctx);
    return {
      ...result,
      warnings: ctx.explain ? [...result.warnings, `Explanations need ${this.manifest.displayName}, so the baseline's own column weights are shown.`] : result.warnings,
      model: { id: fb.manifest.id, displayName: fb.manifest.displayName },
      notice: `Used the built-in baseline model instead of ${this.manifest.displayName}: ${prepared.fallbackReason}.`,
    };
  }

  async predict(table: PrepareContext["table"], target: string, task: Task): Promise<PredictionResult> {
    const ctx: PrepareContext = { table, schema: table.columns, target, task };
    await this.load(undefined, { task });
    return this.decode(await this.run(await this.prepare(ctx)), ctx);
  }
}
