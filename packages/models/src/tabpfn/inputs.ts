import { shuffled } from "../local-tabular/model.js";
import type { TabPfnFrame } from "./encode.js";

/**
 * Context-dependent half of TabPFN's preprocessing for one model call, in the order the 3.5 pipeline runs it (see encode.ts for
 * the table-wide half). Everything is fitted on the train rows only, then applied to train and test rows alike:
 *   1. drop columns that are constant (or entirely blank) in the train rows       RemoveConstantFeaturesStep
 *   2. append a per-row fingerprint in [0,1) so identical rows stay distinguishable AddFingerprintFeaturesStep
 *   3. shuffle the column order with a fixed seed                                  ShuffleFeaturesStep
 *   4. soft-clip numeric columns beyond 12 standard deviations                     TorchSoftClipOutliers (OUTLIER_REMOVAL_STD = 12)
 * The graph's own front-end (NaN flags, imputation, scaling, ECDF) follows in frontend.ts. One estimator only: the Python
 * default runs 4 differently shuffled views and averages them.
 *
 * The fingerprint hash is not SHA-256 (no sync SHA in the browser sidebar); it only has to be a stable pseudo-random value per row.
 */

export const OUTLIER_SIGMA = 12;

export interface TabPfnContext {
  cols: number;
  /** Row-major nTrain×cols and nTest×cols, ready for `TabPfnClassifier.predictProba`. */
  trainX: Float32Array;
  testX: Float32Array;
}

/** Two 32-bit murmur-style lanes over the float32 bit patterns of a row (NaN canonicalised), folded to 53 bits in [0,1). */
function hashRow(row: Float32Array, salt: number): number {
  const bits = new Uint32Array(row.buffer, row.byteOffset, row.length);
  let h1 = (0xdeadbeef ^ salt) >>> 0;
  let h2 = (0x41c6ce57 ^ Math.floor(salt / 4294967296)) >>> 0;
  for (let i = 0; i < bits.length; i++) {
    const w = Number.isNaN(row[i]!) ? 0x7fc00000 : row[i] === 0 ? 0 : bits[i]!;   // -0 and +0 are the same cell
    h1 = Math.imul(h1 ^ w, 2654435761);
    h2 = Math.imul(h2 ^ w, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0) * 2097152 + (h1 >>> 11)) / 9007199254740992;   // 32 + 21 bits
}

/** Train rows get unique fingerprints (a repeated row is re-hashed with a counter); test rows get the plain hash. */
function fingerprints(rows: Float32Array, cols: number, nTrain: number): Float32Array {
  const n = rows.length / cols;
  const salt = nTrain * cols;
  const out = new Float32Array(n);
  const seen = new Set<number>();
  const repeats = new Map<number, number>();
  for (let r = 0; r < n; r++) {
    const row = rows.subarray(r * cols, (r + 1) * cols);
    const base = hashRow(row, salt);
    if (r >= nTrain) {
      out[r] = base;
      continue;
    }
    let count = repeats.get(base) ?? 0;
    let h = count === 0 ? base : hashRow(row, salt + count);
    const allBlank = row.every((v) => Number.isNaN(v));
    while (seen.has(h) && !allBlank) h = hashRow(row, salt + ++count);
    out[r] = h;
    seen.add(out[r]!);
    repeats.set(base, count + 1);
  }
  return out;
}

/** Mean ± OUTLIER_SIGMA·std of a column's non-blank train values, computed twice: the second pass leaves out what the first called outliers. */
function clipBounds(col: Float64Array, nTrain: number): { lower: number; upper: number } {
  if (nTrain <= 1) return { lower: -Infinity, upper: Infinity };
  const stats = (skip?: { lower: number; upper: number }) => {
    let n = 0;
    let sum = 0;
    for (let r = 0; r < nTrain; r++) {
      const v = col[r]!;
      if (Number.isNaN(v) || (skip && (v > skip.upper || v < skip.lower))) continue;
      n++;
      sum += v;
    }
    const mean = sum / Math.max(n, 1);
    let sq = 0;
    for (let r = 0; r < nTrain; r++) {
      const v = col[r]!;
      if (Number.isNaN(v) || (skip && (v > skip.upper || v < skip.lower))) continue;
      sq += (v - mean) ** 2;
    }
    const cut = Math.sqrt(sq / Math.max(n - 1, 1)) * OUTLIER_SIGMA;
    return { lower: mean - cut, upper: mean + cut };
  };
  return stats(stats());
}

/** Soft-clips one column in place: bounds from its first `nTrain` values, applied to every non-blank value. */
export function softClipColumn(col: Float64Array, nTrain: number): void {
  const { lower, upper } = clipBounds(col, nTrain);
  for (let i = 0; i < col.length; i++) {
    const v = col[i]!;
    if (Number.isNaN(v)) continue;
    const lo = Math.max(-Math.log(1 + Math.abs(v)) + lower, v);
    col[i] = Math.min(Math.log(1 + Math.abs(lo)) + upper, lo);
  }
}

export function buildTabPfnInputs(frame: TabPfnFrame, train: number[], test: number[], seed = 0): TabPfnContext {
  const nTrain = train.length;
  const rows = [...train, ...test];
  const nRows = rows.length;

  // 1. Constant columns: kept unless every train value equals the first, or all are blank.
  const keep: number[] = [];
  for (let j = 0; j < frame.cols; j++) {
    const first = frame.matrix[train[0]! * frame.cols + j]!;
    let allBlank = true;
    let allSame = true;
    for (const r of train) {
      const v = frame.matrix[r * frame.cols + j]!;
      if (!Number.isNaN(v)) allBlank = false;
      if (v !== first) allSame = false;
    }
    if (!allBlank && !allSame) keep.push(j);
  }
  if (keep.length === 0) throw new Error("every input column is constant in the training rows");
  const width = keep.length;
  const kept = new Float32Array(nRows * width);
  rows.forEach((row, i) => keep.forEach((j, k) => (kept[i * width + k] = frame.matrix[row * frame.cols + j]!)));
  const keptCategorical = keep.map((j) => frame.categorical[j]!);

  // 2. Fingerprint column, appended and numeric.
  const cols = width + 1;
  const withFp = new Float32Array(nRows * cols);
  const fp = fingerprints(kept, width, nTrain);
  for (let i = 0; i < nRows; i++) {
    withFp.set(kept.subarray(i * width, (i + 1) * width), i * cols);
    withFp[i * cols + width] = fp[i]!;
  }
  const categorical = [...keptCategorical, false];

  // 3. Column order. 4. Soft clip numeric columns, bounds from the train rows.
  const order = shuffled(Array.from({ length: cols }, (_, j) => j), seed + 1);
  const all = new Float32Array(nRows * cols);
  order.forEach((src, j) => {
    const col = Float64Array.from({ length: nRows }, (_, i) => withFp[i * cols + src]!);
    if (!categorical[src]) softClipColumn(col, nTrain);
    for (let i = 0; i < nRows; i++) all[i * cols + j] = col[i]!;
  });

  return { cols, trainX: all.slice(0, nTrain * cols), testX: all.slice(nTrain * cols) };
}
