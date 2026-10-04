/**
 * The reference model every score is compared against: ridge linear regression for numeric targets, multinomial logistic
 * regression for categorical ones. Inputs are the encoded feature matrix (one-hot categories, imputed numbers); features
 * are standardised on the train rows so one scale doesn't swamp the rest. Plain TypeScript, no dependencies.
 */

const RIDGE = 1e-3;
const MAX_TRAIN_ROWS = 2000;
const LOGISTIC_STEPS = 150;

interface Scaler {
  keep: number[];
  mean: number[];
  scale: number[];
}

function fitScaler(trainX: number[][]): Scaler {
  const width = trainX[0]?.length ?? 0;
  const n = trainX.length;
  const keep: number[] = [];
  const mean: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < width; j++) {
    let sum = 0;
    for (const row of trainX) sum += row[j]!;
    const m = sum / n;
    let sq = 0;
    for (const row of trainX) sq += (row[j]! - m) ** 2;
    const sd = Math.sqrt(sq / n);
    if (sd < 1e-12) continue; // constant in the train rows: carries nothing
    keep.push(j);
    mean.push(m);
    scale.push(sd);
  }
  return { keep, mean, scale };
}

function transform(s: Scaler, rows: number[][]): number[][] {
  return rows.map((row) => s.keep.map((j, c) => (row[j]! - s.mean[c]!) / s.scale[c]!));
}

/** Evenly spaced subsample so a big table doesn't make the reference model the slow part. */
function thin<T>(rows: T[], ys: number[]): { rows: T[]; ys: number[] } {
  if (rows.length <= MAX_TRAIN_ROWS) return { rows, ys };
  const pick = Array.from({ length: MAX_TRAIN_ROWS }, (_, i) => Math.floor((i * rows.length) / MAX_TRAIN_ROWS));
  return { rows: pick.map((i) => rows[i]!), ys: pick.map((i) => ys[i]!) };
}

/** Solves A x = b in place by Gaussian elimination with partial pivoting; A is symmetric positive definite here. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const d = a[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) a[r]![c]! -= f * a[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * x[c]!;
    const d = a[r]![r]!;
    x[r] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
  return x;
}

/**
 * Ridge least squares through the origin: argmin Σ wᵢ (yᵢ − xᵢ·β)² + ridge · Σwᵢ · |β|², via the normal equations.
 * Callers centre / standardise their data first; `weights` null means every row counts once. Shared by the reference
 * linear regression and by the Shapley-kernel fit in explain.ts.
 */
export function weightedRidge(x: number[][], y: number[], weights: number[] | null, ridge: number): number[] {
  const n = x.length;
  const d = x[0]?.length ?? 0;
  const gram = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const xty = new Array<number>(d).fill(0);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const row = x[i]!;
    const wi = weights ? weights[i]! : 1;
    total += wi;
    const yi = y[i]!;
    for (let p = 0; p < d; p++) {
      const xp = wi * row[p]!;
      xty[p]! += xp * yi;
      const g = gram[p]!;
      for (let q = p; q < d; q++) g[q]! += xp * row[q]!;
    }
  }
  for (let p = 0; p < d; p++) {
    for (let q = 0; q < p; q++) gram[p]![q] = gram[q]![p]!;
    gram[p]![p]! += ridge * total;
  }
  return solve(gram, xty);
}

export interface LinearFit {
  predict(testX: number[][]): number[];
  /** Per input column: how hard the fitted model leans on it (|coefficient| on the standardised column; 0 when unused). */
  weights: number[];
}

/** Ridge linear regression. With no usable features it predicts the train mean. */
export function fitLinearRegression(trainX: number[][], trainY: number[]): LinearFit {
  const fit = thin(trainX, trainY);
  const ys = fit.ys;
  const width = trainX[0]?.length ?? 0;
  const meanY = ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length);
  const scaler = fitScaler(fit.rows);
  const d = scaler.keep.length;
  if (d === 0) return { predict: (testX) => testX.map(() => meanY), weights: new Array<number>(width).fill(0) };

  const x = transform(scaler, fit.rows);
  const w = weightedRidge(x, ys.map((y) => y - meanY), null, RIDGE);
  const weights = new Array<number>(width).fill(0);
  scaler.keep.forEach((j, c) => (weights[j] = Math.abs(w[c]!)));
  return { predict: (testX) => transform(scaler, testX).map((row) => row.reduce((acc, v, j) => acc + v * w[j]!, meanY)), weights };
}

/** Ridge linear regression: predictions for `testX`. With no usable features it predicts the train mean. */
export function linearRegressionPredict(trainX: number[][], trainY: number[], testX: number[][]): number[] {
  return fitLinearRegression(trainX, trainY).predict(testX);
}

export interface LogisticFit {
  /** Class probabilities (rows × classes) for each test row. */
  proba(testX: number[][]): number[][];
  /** Per input column: mean |weight| over the classes on the standardised column; 0 when unused. */
  weights: number[];
}

/** Multinomial logistic regression (plain logistic when there are two classes). */
export function fitLogisticRegression(trainX: number[][], trainClass: number[], classes: number): LogisticFit {
  const fit = thin(trainX, trainClass);
  const width = trainX[0]?.length ?? 0;
  const labels = fit.ys;
  const counts = new Array<number>(classes).fill(0);
  for (const c of labels) counts[c]!++;
  const majority = counts.indexOf(Math.max(...counts));
  const scaler = fitScaler(fit.rows);
  const d = scaler.keep.length;
  if (d === 0 || counts.filter((c) => c > 0).length < 2) {
    const only = Array.from({ length: classes }, (_, c) => (c === majority ? 1 : 0));
    return { proba: (testX) => testX.map(() => only.slice()), weights: new Array<number>(width).fill(0) };
  }

  const x = transform(scaler, fit.rows);
  const n = x.length;
  // Weights are (d + 1) per class, bias last. Adam on the mean cross-entropy plus a small L2 penalty.
  const stride = d + 1;
  const w = new Float64Array(classes * stride);
  const m = new Float64Array(w.length);
  const v = new Float64Array(w.length);
  const grad = new Float64Array(w.length);
  const logits = new Float64Array(classes);
  const lr = 0.1;
  const l2 = 1e-3;

  const score = (row: number[]): void => {
    for (let c = 0; c < classes; c++) {
      let z = w[c * stride + d]!;
      for (let j = 0; j < d; j++) z += w[c * stride + j]! * row[j]!;
      logits[c] = z;
    }
  };

  for (let step = 1; step <= LOGISTIC_STEPS; step++) {
    grad.fill(0);
    for (let i = 0; i < n; i++) {
      const row = x[i]!;
      score(row);
      let top = -Infinity;
      for (let c = 0; c < classes; c++) top = Math.max(top, logits[c]!);
      let total = 0;
      for (let c = 0; c < classes; c++) total += (logits[c] = Math.exp(logits[c]! - top));
      for (let c = 0; c < classes; c++) {
        const err = logits[c]! / total - (labels[i] === c ? 1 : 0);
        const base = c * stride;
        for (let j = 0; j < d; j++) grad[base + j]! += err * row[j]!;
        grad[base + d]! += err;
      }
    }
    const b1 = 1 - 0.9 ** step;
    const b2 = 1 - 0.999 ** step;
    for (let k = 0; k < w.length; k++) {
      const isBias = k % stride === d;
      const g = grad[k]! / n + (isBias ? 0 : l2 * w[k]!);
      m[k] = 0.9 * m[k]! + 0.1 * g;
      v[k] = 0.999 * v[k]! + 0.001 * g * g;
      w[k]! -= (lr * (m[k]! / b1)) / (Math.sqrt(v[k]! / b2) + 1e-8);
    }
  }

  const weights = new Array<number>(width).fill(0);
  scaler.keep.forEach((j, c) => {
    let total = 0;
    for (let k = 0; k < classes; k++) total += Math.abs(w[k * stride + c]!);
    weights[j] = total / classes;
  });
  const proba = (testX: number[][]): number[][] =>
    transform(scaler, testX).map((row) => {
      score(row);
      let top = -Infinity;
      for (let c = 0; c < classes; c++) top = Math.max(top, logits[c]!);
      const e = Array.from(logits, (z) => Math.exp(z - top));
      const total = e.reduce((a, b) => a + b, 0);
      return e.map((v) => v / total);
    });
  return { proba, weights };
}

/** Multinomial logistic regression (plain logistic when there are two classes): the predicted class index for each test row. */
export function logisticRegressionPredict(trainX: number[][], trainClass: number[], testX: number[][], classes: number): number[] {
  return fitLogisticRegression(trainX, trainClass, classes)
    .proba(testX)
    .map((p) => p.reduce((best, v, c) => (v > p[best]! ? c : best), 0));
}
