/**
 * TypeScript port of TabPFN-3.5's data-dependent front-end (`_preprocess_raw` in tabpfn_v3_5.py), which the ONNX graph cannot
 * contain (it needs sort + searchsorted). For one estimator it turns raw feature cells into the three tensors the graph takes:
 *   scaled  - NaN/inf mean-imputed, standard-scaled on the train rows, clipped to ±100
 *   nanInd  - NaN → -2, +inf → 2, -inf → 4, else 0
 *   ecdf    - midrank ECDF of each cell against the train rows (via bucket edges), in [0, 1]
 * Arithmetic is rounded to float32 at each step so ties and bucket edges behave like the PyTorch reference.
 */

const f32 = Math.fround;
const EPS32 = 1.1920928955078125e-7;
export const ECDF_DEFAULT_BUCKETS = 8192;

export interface FrontendInput {
  rows: number;
  cols: number;
  /** Leading rows used as training context; the rest are test rows. Must be >= 1. */
  nTrain: number;
  /** Row-major rows×cols. NaN and ±Infinity are allowed. */
  x: ArrayLike<number>;
  /** Max ECDF bucket edges per column (model config: 8192). */
  numBuckets?: number;
}

export interface FrontendOutput {
  rows: number;
  cols: number;
  /** Each row-major rows×cols, i.e. the (1, rows, cols) graph inputs. */
  scaled: Float32Array;
  nanInd: Float32Array;
  ecdf: Float32Array;
}

/** torch.round: ties go to the even integer. */
function roundHalfEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - Math.trunc(v)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** First index with arr[i] >= target (torch.searchsorted side="left"). */
function lowerBound(arr: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with arr[i] > target (torch.searchsorted side="right"). */
function upperBound(arr: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface EcdfContext {
  edges: Float32Array;
  below: Float32Array;
  atMost: Float32Array;
}

/** `_build_ecdf_context` for one column: bucket edges with exact counts of train values below / at-most each edge. */
function buildEcdfContext(trainValues: Float32Array, numBuckets: number): EcdfContext {
  const n = trainValues.length;
  const sorted = Float32Array.from(trainValues).sort();
  const k = Math.min(numBuckets, n);

  const distinctIdx = new Int32Array(n);
  for (let i = 1; i < n; i++) distinctIdx[i] = distinctIdx[i - 1]! + (sorted[i] !== sorted[i - 1] ? 1 : 0);
  const numDistinct = distinctIdx[n - 1]! + 1;

  const targets = new Int32Array(k);
  if (k > 1) {
    const ratioDistinct = f32((numDistinct - 1) / (k - 1));
    const ratioRows = f32((n - 1) / (k - 1));
    for (let j = 0; j < k; j++) {
      // Evenly spaced distinct indices while every distinct value fits; evenly spaced row positions (mass-uniform) above that.
      targets[j] =
        numDistinct <= k ? roundHalfEven(f32(j * ratioDistinct)) : distinctIdx[roundHalfEven(f32(j * ratioRows))]!;
    }
  }

  const edges = new Float32Array(k);
  const below = new Float32Array(k);
  const atMost = new Float32Array(k);
  for (let j = 0; j < k; j++) {
    const b = lowerBound(distinctIdx, targets[j]!);
    below[j] = b;
    atMost[j] = upperBound(distinctIdx, targets[j]!);
    edges[j] = sorted[b]!;
  }
  return { edges, below, atMost };
}

/** `_ecdf_midrank_counts` / `_in_context_ecdf` for one finite value. */
function ecdfRank(v: number, ctx: EcdfContext): number {
  const { edges, below, atMost } = ctx;
  const k = edges.length;
  const left = lowerBound(edges, v);
  const right = upperBound(edges, v);
  const loIdx = Math.max(left - 1, 0);
  const hiIdx = Math.min(left, k - 1);
  const edgeLo = edges[loIdx]!;
  const edgeHi = edges[hiIdx]!;
  const atMostLo = atMost[loIdx]!;
  const belowHi = below[hiIdx]!;

  const width = f32(edgeHi - edgeLo);
  const weight = width > 0 ? f32(f32(v - edgeLo) / width) : 0;
  let counts = f32(atMostLo + f32(weight * f32(belowHi - atMostLo)));
  const isEdge = right > left;
  if (isEdge) counts = f32(0.5 * f32(belowHi + atMost[hiIdx]!));
  if (left === 0 && !isEdge) counts = 0;
  return f32(counts / atMost[k - 1]!);
}

export function tabpfnFrontend(input: FrontendInput): FrontendOutput {
  const { rows, cols, nTrain: n, x } = input;
  const numBuckets = input.numBuckets ?? ECDF_DEFAULT_BUCKETS;
  if (!(n >= 1 && n <= rows)) throw new Error(`nTrain must be in [1, rows]; got ${n} of ${rows}`);
  if (x.length !== rows * cols) throw new Error(`x has ${x.length} cells, expected ${rows}×${cols}`);

  const scaled = new Float32Array(rows * cols);
  const nanInd = new Float32Array(rows * cols);
  const ecdf = new Float32Array(rows * cols);
  const col = new Float32Array(rows);
  const trainFilled = new Float32Array(n);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) col[r] = x[r * cols + c]!;

    // 1. Impute non-finite cells with the mean of the finite train cells (0 if there are none), as float32.
    let sum = 0;
    let count = 0;
    for (let r = 0; r < n; r++) {
      if (Number.isFinite(col[r]!)) {
        sum += col[r]!;
        count++;
      }
    }
    const fillMean = count > 0 ? f32(sum / count) : 0;

    // 2. Fit the scaler on the imputed train rows (N-1 std; constant column and single row -> std 1).
    let tsum = 0;
    for (let r = 0; r < n; r++) tsum += Number.isFinite(col[r]!) ? col[r]! : fillMean;
    const mean = f32(tsum / n);
    let sq = 0;
    for (let r = 0; r < n; r++) {
      const d = f32((Number.isFinite(col[r]!) ? col[r]! : fillMean) - mean);
      sq += f32(d * d);
    }
    let std = f32(Math.sqrt(sq / Math.max(n - 1, 1)));
    if (std === 0 || n === 1) std = 1;
    const denom = f32(std + EPS32);

    // 3. Non-finite cells are re-filled with the scaler mean; those values are what get ranked and scaled.
    const filled = (r: number): number => (Number.isFinite(col[r]!) ? col[r]! : mean);
    for (let r = 0; r < n; r++) trainFilled[r] = filled(r);
    const ctx = buildEcdfContext(trainFilled, numBuckets);

    for (let r = 0; r < rows; r++) {
      const raw = col[r]!;
      const v = filled(r);
      const i = r * cols + c;
      const z = f32(f32(v - mean) / denom);
      scaled[i] = z > 100 ? 100 : z < -100 ? -100 : z;
      nanInd[i] = Number.isNaN(raw) ? -2 : raw === Infinity ? 2 : raw === -Infinity ? 4 : 0;
      ecdf[i] = ecdfRank(v, ctx);
    }
  }
  return { rows, cols, scaled, nanInd, ecdf };
}
