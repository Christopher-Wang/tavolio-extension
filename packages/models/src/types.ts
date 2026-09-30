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
  artifact: { uri: string; format: "onnx"; sha256?: string };
}

/** One entry of "Most useful signals" (§6, §9). */
export interface FeatureSignal {
  name: string;
  /** Share of the strongest signal, 0..1. */
  strength: number;
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
  /** Held-out evaluation vs. dumb baseline (§6, §9). Never thresholds like "Good". */
  evaluation?: {
    kind: "classification" | "regression";
    accuracy?: number;
    baselineAccuracy?: number;
    mae?: number;
    rmse?: number;
    r2?: number;
    baselineMae?: number;
  };
  /** The strategy that produced `evaluation` (absent evaluation + "none" = scoring skipped on purpose). */
  validation?: ValidationStrategy["kind"];
  featureSignals?: FeatureSignal[];
  metrics?: Record<string, number>;
  /** Which model produced this result (set by predictTable). */
  model?: { id: string; displayName: string };
  warnings: string[];
}

export interface PrepareContext {
  table: Table;
  schema: ColumnSchema[];
  target: string;
  task: Task;
  /** Defaults to random when absent. */
  validation?: ValidationStrategy;
}

export interface TavolioModel {
  manifest: ModelManifest;
  load(): Promise<void>;
  prepare(ctx: PrepareContext): Promise<unknown>;
  run(prepared: unknown): Promise<unknown>;
  decode(outputs: unknown, ctx: PrepareContext): Promise<PredictionResult>;
  predict(table: Table, target: string, task: Task): Promise<PredictionResult>;
}
