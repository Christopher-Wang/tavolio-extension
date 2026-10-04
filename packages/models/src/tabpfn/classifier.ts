import type { Runtime } from "@tavolio/runtime";
import { tabpfnFrontend } from "./frontend.js";

/** Class ids must be below this: the exported graph uses a fixed one-hot width (see tools/tabpfn-export/wrapper.py). */
export const TABPFN_MAX_CLASSES = 64;
/** Width of the logits the graph returns; only the first `numClasses` are meaningful. */
export const TABPFN_LOGIT_WIDTH = 160;

export interface TabPfnInput {
  cols: number;
  /** Row-major nTrain×cols. NaN / ±Infinity allowed. Categoricals must already be ordinal-encoded. */
  trainX: ArrayLike<number>;
  /** Class ids in [0, numClasses), length nTrain. */
  trainY: ArrayLike<number>;
  /** Row-major nTest×cols. */
  testX: ArrayLike<number>;
  numClasses: number;
}

export interface TabPfnOutput {
  /** Row-major nTest×numClasses class probabilities. */
  probabilities: Float32Array;
  latencyMs: number;
}

/** In-context classifier on the exported TabPFN-3.5-Fast graph: front-end in TypeScript, transformer through the Runtime. */
export class TabPfnClassifier {
  constructor(
    private readonly runtime: Runtime,
    private readonly modelUri: string,
  ) {}

  async predictProba(input: TabPfnInput): Promise<TabPfnOutput> {
    const { cols, numClasses: k } = input;
    const nTrain = input.trainY.length;
    const nTest = input.testX.length / cols;
    if (!Number.isInteger(k) || k < 2 || k > TABPFN_MAX_CLASSES) {
      throw new Error(`TabPFN supports 2–${TABPFN_MAX_CLASSES} classes; got ${k}`);
    }
    if (!(cols >= 1) || input.trainX.length !== nTrain * cols || !Number.isInteger(nTest) || nTrain < 1 || nTest < 1) {
      throw new Error(`Inconsistent shapes: ${nTrain} train labels, trainX ${input.trainX.length}, testX ${input.testX.length}, cols ${cols}`);
    }
    const y = new Float32Array(nTrain);
    for (let i = 0; i < nTrain; i++) {
      const c = input.trainY[i]!;
      if (!Number.isInteger(c) || c < 0 || c >= k) throw new Error(`Class id ${c} at train row ${i} is outside [0, ${k})`);
      y[i] = c;
    }

    const rows = nTrain + nTest;
    const x = new Float32Array(rows * cols);
    x.set(Array.from(input.trainX), 0);
    x.set(Array.from(input.testX), nTrain * cols);
    const front = tabpfnFrontend({ rows, cols, nTrain, x });

    const result = await this.runtime.run({
      model: this.modelUri,
      inputs: {
        x: { name: "x", dims: [1, rows, cols], data: front.scaled },
        nan_ind: { name: "nan_ind", dims: [1, rows, cols], data: front.nanInd },
        ecdf: { name: "ecdf", dims: [1, rows, cols], data: front.ecdf },
        y: { name: "y", dims: [nTrain, 1], data: y },
      },
    });
    const logits = result.outputs["logits"];
    if (!logits || !(logits.data instanceof Float32Array) || logits.data.length !== nTest * TABPFN_LOGIT_WIDTH) {
      throw new Error(`Unexpected model output: ${logits ? `dims [${logits.dims}]` : "no 'logits' tensor"}`);
    }

    const probabilities = new Float32Array(nTest * k);
    for (let r = 0; r < nTest; r++) {
      const base = r * TABPFN_LOGIT_WIDTH;
      let max = -Infinity;
      for (let c = 0; c < k; c++) max = Math.max(max, logits.data[base + c]!);
      let sum = 0;
      for (let c = 0; c < k; c++) sum += Math.exp(logits.data[base + c]! - max);
      for (let c = 0; c < k; c++) probabilities[r * k + c] = Math.exp(logits.data[base + c]! - max) / sum;
    }
    // A numerically broken run (e.g. fp16 overflow on some GPU) must fail loudly, not write NaN-derived predictions into a sheet.
    if (probabilities.some((p) => !Number.isFinite(p))) throw new Error("the model returned invalid numbers");
    return { probabilities, latencyMs: result.latencyMs };
  }
}
