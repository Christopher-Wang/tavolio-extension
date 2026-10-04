import type { ColumnSchema, Table } from "@tavolio/table";

/** Single task concept; the adapter owns classification/regression differences. */
export type Task =
  | { type: "classification"; classes: string[] }
  | { type: "regression" };

export interface ModelManifest {
  id: string;
  displayName: string;
  version: string;
  taskKinds: Array<"classification" | "regression">;
  /** The weights to download; absent for a hosted model, which has none. */
  artifact?: { uri: string; format: "onnx"; sha256?: string };
  /** What the model wants to run on; shown in the UI. Omitted = CPU. "remote": a hosted API, so the table leaves the device. */
  preferredRuntime?: "cpu" | "webgpu" | "remote";
}

/** One entry of "Most useful signals" (§6, §9). */
export interface FeatureSignal {
  name: string;
  /** Share of the strongest signal, 0..1. */
  strength: number;
  /** From an explanation: the mean absolute Shapley value, i.e. how far this column moves the predicted outcome's probability (0..1). */
  impact?: number;
  /** From an explanation: the spread of this column's absolute Shapley values over the explained rows (same units as `impact`). */
  spread?: { min: number; max: number; std: number };
}

/** Why one row got its prediction: each column's push on the predicted outcome (classification: its probability; regression: the target's own units), from a typical row to this one. */
export interface RowExplanation {
  /** 0-based data row. */
  row: number;
  /** The predicted class (regression: the target's name). */
  outcome: string;
  /** Probability of `outcome` (regression: the predicted value) when no column is known. */
  base: number;
  /** Probability of `outcome` (regression: the predicted value) for this row; base + Σ contributions. */
  final: number;
  /** Every column the model used, biggest push first. `phi` is signed, in probability units (regression: the target's units). */
  contributions: Array<{ name: string; phi: number }>;
}

/**
 * How prediction quality is scored.
 *  - random: hold out a random share (30% by default) of the labeled rows.
 *  - selection: hold out exactly `rows` (0-based data-row indexes, e.g. rows the user selected).
 *  - none: skip scoring; every labeled row is used for prediction.
 */
export type ValidationStrategy =
  | { kind: "random"; /** Share held out, 0-1; 0.3 when absent. */ testFraction?: number }
  | { kind: "selection"; rows: number[] }
  | { kind: "none" };

export interface PredictionResult {
  task: Task;
  target: string;
  predictions: unknown[];
  probabilities?: number[][];
  /** Confidence per predicted row, 0..1 (classification share / regression 1). */
  confidences?: number[];
  /** Rows whose target was blank: prediction applies there (§7, §11). */
  newRowIndexes?: number[];
  /** Regression with `PrepareContext.interval`: per row a prediction interval in the target's units (null for rows that weren't predicted). */
  intervals?: Array<{ lower: number; upper: number } | null>;
  /** Coverage of `intervals`, 0..1 (0.95 = a 95% interval). */
  intervalLevel?: number;
  /** Held-out evaluation vs. dumb baseline (§6, §9). Never thresholds like "Good". */
  evaluation?: {
    kind: "classification" | "regression";
    accuracy?: number;
    baselineAccuracy?: number;
    mae?: number;
    rmse?: number;
    r2?: number;
    baselineMae?: number;
    /** What `baselineAccuracy` / `baselineMae` measure: absent = a plain logistic / linear regression; "majority" / "mean" = always guessing the most common value / the average (used when the model itself is that regression). */
    baselineKind?: "majority" | "mean";
  };
  /** The strategy that produced `evaluation` (absent evaluation + "none" = scoring skipped on purpose). */
  validation?: ValidationStrategy["kind"];
  featureSignals?: FeatureSignal[];
  /** Set when `featureSignals` came from the Shapley explanation (PrepareContext.explain) instead of the quick ranking. */
  /** Explains one row on demand (same method as `explanation`). Only on results made with `explain`; lives in memory, not serialisable. */
  explainRow?: (row: number) => Promise<RowExplanation>;
  /** Explains many rows at once, for writing every prediction's pushes into the sheet. Classification pushes are in probability units, regression pushes in the target's own units. */
  explainRows?: (rows: number[]) => Promise<RowExplanation[]>;
  explanation?: { method: "identity-shap"; rows: number; evaluations: number };
  metrics?: Record<string, number>;
  /** Which model produced this result (set by predictTable). */
  model?: { id: string; displayName: string };
  warnings: string[];
  /** Something the user should see up front, not in the collapsed notes (e.g. the preferred model couldn't run). */
  notice?: string;
}

export interface PrepareContext {
  table: Table;
  schema: ColumnSchema[];
  target: string;
  task: Task;
  /** Defaults to random when absent. */
  validation?: ValidationStrategy;
  /** Explain the predictions (Kernel SHAP on the end coalitions): use it for `featureSignals` and per-row explanations. Slower; models that can't just ignore it. */
  explain?: boolean;
  /** Regression only: also give a prediction interval covering this share of outcomes, 0..1 (0.95). Absent = none. */
  interval?: number;
  /** Also score a simple reference model on the same rows, for comparison. Default true; when false no `baseline*` figures are produced. */
  baseline?: boolean;
  /** Called (and awaited) just before the simple reference model is fitted for the quality comparison, so a UI can show that step. */
  onBaseline?: () => void | Promise<void>;
}

/** What's known about a request before its features are built, so a model can start loading (or skip loading) in parallel with `prepare`. */
export interface LoadHint {
  task: Task;
}

/** Progress while a model's artifact is fetched / prepared (first run downloads it; later runs hit the cache). */
export interface LoadProgress {
  phase: "download" | "prepare";
  /** Bytes so far / in total, when known (download phase). */
  loaded?: number;
  total?: number;
}

export interface TavolioModel {
  manifest: ModelManifest;
  /**
   * Fetch/warm the model. Models with nothing to load just resolve; `onProgress` is only called when there is something to show.
   * `hint` lets a model skip loading when it is going to delegate to another one. Called alongside `prepare`, so it must not depend on it.
   */
  load(onProgress?: (p: LoadProgress) => void, hint?: LoadHint): Promise<void>;
  prepare(ctx: PrepareContext): Promise<unknown>;
  run(prepared: unknown): Promise<unknown>;
  decode(outputs: unknown, ctx: PrepareContext): Promise<PredictionResult>;
  predict(table: Table, target: string, task: Task): Promise<PredictionResult>;
}
