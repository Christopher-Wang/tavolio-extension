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

export interface PredictionResult {
  task: Task;
  target: string;
  predictions: unknown[];
  probabilities?: number[][];
  metrics?: Record<string, number>;
  warnings: string[];
}

export interface PrepareContext {
  table: Table;
  schema: ColumnSchema[];
  target: string;
  task: Task;
}

export interface TavolioModel {
  manifest: ModelManifest;
  load(): Promise<void>;
  prepare(ctx: PrepareContext): Promise<unknown>;
  run(prepared: unknown): Promise<unknown>;
  decode(outputs: unknown, ctx: PrepareContext): Promise<PredictionResult>;
  predict(table: Table, target: string, task: Task): Promise<PredictionResult>;
}
