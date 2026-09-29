import { columnValues } from "@tavolio/table";
import type { Runtime } from "@tavolio/runtime";
import type {
  PrepareContext,
  PredictionResult,
  TavolioModel,
  Task,
} from "../types.js";
import { encodeFeatures } from "./adapter.js";
import { LOCAL_TABULAR_MANIFEST } from "./manifest.js";

interface Prepared {
  ctx: PrepareContext;
  featureNames: string[];
  matrix: number[][];
}

/**
 * local-tabular v1. Currently a transparent baseline (majority-class /
 * mean-target) behind the TavolioModel contract so the Sheets shell,
 * pipeline, and tests work end-to-end before a real ONNX artifact lands.
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
    const n = targetValues.length;

    if (ctx.task.type === "classification") {
      const classes = ctx.task.classes;
      const counts = new Map<string, number>();
      for (const v of targetValues) {
        const k = String(v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let majority = classes[0]!;
      let best = -1;
      for (const c of classes) {
        const n_c = counts.get(c) ?? 0;
        if (n_c > best) {
          best = n_c;
          majority = c;
        }
      }
      const majorityIdx = Math.max(0, classes.indexOf(majority));
      const predictions = new Array(n).fill(majority);
      const probabilities = new Array(n).fill(null).map(() => {
        const p = new Array(classes.length).fill(0);
        p[majorityIdx] = 1;
        return p as number[];
      });
      const accuracy = n === 0 ? 0 : best / n;
      return {
        task: ctx.task,
        target: ctx.target,
        predictions,
        probabilities,
        metrics: { trainAccuracyMajority: round4(accuracy) },
        warnings: [
          "local-tabular-v1 baseline: majority-class predictions until the ONNX artifact lands.",
          `features=${prepared.featureNames.length}`,
        ],
      };
    }

    const nums = targetValues
      .map((v) => (typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""))))
      .filter((x) => Number.isFinite(x));
    const mean = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    return {
      task: ctx.task,
      target: ctx.target,
      predictions: new Array(n).fill(mean),
      metrics: { trainMean: round4(mean), n: nums.length },
      warnings: [
        "local-tabular-v1 baseline: mean-target predictions until the ONNX artifact lands.",
        `features=${prepared.featureNames.length}`,
      ],
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

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
