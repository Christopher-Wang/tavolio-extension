import type { Runtime } from "@tavolio/runtime";
import { tabpfnFrontend } from "./frontend.js";
import { TABPFN_BUCKET_MEANS_B64 } from "./bucketMeans.js";

/** Width of the regression head: the bar distribution has this many buckets. */
export const TABPFN_REGRESSION_BUCKETS = 5000;

let bucketMeans: Float32Array | undefined;
/** Per-bucket means in z-score units (see bucketMeans.ts). */
function buckets(): Float32Array {
  if (!bucketMeans) {
    const bin = atob(TABPFN_BUCKET_MEANS_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    bucketMeans = new Float32Array(bytes.buffer);
  }
  return bucketMeans;
}

export interface TabPfnRegressionInput {
  cols: number;
  /** Row-major nTrain×cols. NaN / ±Infinity allowed. Categoricals must already be ordinal-encoded. */
  trainX: ArrayLike<number>;
  /** Known target values, length nTrain. */
  trainY: ArrayLike<number>;
  /** Row-major nTest×cols. */
  testX: ArrayLike<number>;
  /** Also return a central prediction interval covering this share of outcomes, 0..1 (0.95). */
  interval?: number;
}

export interface TabPfnRegressionOutput {
  /** Predicted mean per test row, in the target's own units. */
  means: Float64Array;
  /** With `interval`: per test row the bounds of the central interval, in the target's own units. */
  lower?: Float64Array;
  upper?: Float64Array;
  latencyMs: number;
}

/** In-context regressor on the exported TabPFN-3.5-Fast regression graph: z-scored targets in, bar-distribution mean out. */
export class TabPfnRegressor {
  constructor(
    private readonly runtime: Runtime,
    private readonly modelUri: string,
  ) {}

  async predictMean(input: TabPfnRegressionInput): Promise<TabPfnRegressionOutput> {
    const { cols } = input;
    const nTrain = input.trainY.length;
    const nTest = input.testX.length / cols;
    if (!(cols >= 1) || input.trainX.length !== nTrain * cols || !Number.isInteger(nTest) || nTrain < 1 || nTest < 1) {
      throw new Error(`Inconsistent shapes: ${nTrain} train targets, trainX ${input.trainX.length}, testX ${input.testX.length}, cols ${cols}`);
    }
    let sum = 0;
    for (let i = 0; i < nTrain; i++) {
      const v = input.trainY[i]!;
      if (!Number.isFinite(v)) throw new Error(`Target ${v} at train row ${i} is not a finite number`);
      sum += v;
    }
    const mean = sum / nTrain;
    let ss = 0;
    for (let i = 0; i < nTrain; i++) ss += (input.trainY[i]! - mean) ** 2;
    const std = Math.sqrt(ss / nTrain);
    // Same as TabPFN: a constant target is answered directly, the model has nothing to learn from.
    if (std === 0) {
      const flat = new Float64Array(nTest).fill(mean);
      return input.interval ? { means: flat, lower: flat, upper: flat, latencyMs: 0 } : { means: flat, latencyMs: 0 };
    }
    const y = new Float32Array(nTrain);
    for (let i = 0; i < nTrain; i++) y[i] = (input.trainY[i]! - mean) / (std + 1e-20);

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
    const width = TABPFN_REGRESSION_BUCKETS;
    if (!logits || !(logits.data instanceof Float32Array) || logits.data.length !== nTest * width) {
      throw new Error(`Unexpected model output: ${logits ? `dims [${logits.dims}]` : "no 'logits' tensor"}`);
    }

    const centres = buckets();
    const means = new Float64Array(nTest);
    const lower = input.interval ? new Float64Array(nTest) : undefined;
    const upper = input.interval ? new Float64Array(nTest) : undefined;
    const tail = input.interval ? (1 - input.interval) / 2 : 0;
    const scale = std + 1e-20;
    for (let r = 0; r < nTest; r++) {
      const base = r * width;
      let max = -Infinity;
      for (let c = 0; c < width; c++) max = Math.max(max, logits.data[base + c]!);
      let norm = 0;
      let acc = 0;
      for (let c = 0; c < width; c++) {
        const e = Math.exp(logits.data[base + c]! - max);
        norm += e;
        acc += e * centres[c]!;
      }
      means[r] = (acc / norm) * scale + mean;
      if (lower && upper) {
        // Quantiles of the predicted distribution: walk its CDF over the bucket centres, interpolating inside a bucket.
        const at = (q: number): number => {
          const target = q * norm;
          const data = logits.data as Float32Array;
          let cum = 0;
          for (let c = 0; c < width; c++) {
            const e = Math.exp(data[base + c]! - max);
            if (cum + e >= target) {
              const prev = c > 0 ? centres[c - 1]! : centres[c]!;
              const frac = e > 0 ? (target - cum) / e : 0;
              return (prev + (centres[c]! - prev) * frac) * scale + mean;
            }
            cum += e;
          }
          return centres[width - 1]! * scale + mean;
        };
        lower[r] = at(tail);
        upper[r] = at(1 - tail);
      }
    }
    // A numerically broken run (e.g. fp16 overflow on some GPU) must fail loudly, not write NaN-derived predictions into a sheet.
    if (means.some((v) => !Number.isFinite(v))) throw new Error("the model returned invalid numbers");
    if (lower && upper && (lower.some((v) => !Number.isFinite(v)) || upper.some((v) => !Number.isFinite(v)))) throw new Error("the model returned invalid numbers");
    return { means, lower, upper, latencyMs: result.latencyMs };
  }
}
