export function accuracy(predicted: unknown[], actual: unknown[]): number {
  if (predicted.length !== actual.length) throw new Error("Length mismatch");
  if (actual.length === 0) return 0;
  let correct = 0;
  for (let i = 0; i < actual.length; i++) {
    if (String(predicted[i]) === String(actual[i])) correct++;
  }
  return correct / actual.length;
}

/** Majority-class accuracy: the baseline Tavolio must beat (§6). */
export function majorityBaselineAccuracy(actual: unknown[]): number {
  const counts = new Map<string, number>();
  for (const v of actual) {
    const k = String(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (actual.length === 0) return 0;
  return Math.max(...counts.values()) / actual.length;
}

/** Mean-target MAE: the regression baseline Tavolio must beat (§9). */
export function meanBaselineMae(actual: number[]): number {
  if (actual.length === 0) return 0;
  const mean = actual.reduce((a, b) => a + b, 0) / actual.length;
  return mae(new Array(actual.length).fill(mean), actual);
}

export function rmse(predicted: number[], actual: number[]): number {
  if (predicted.length !== actual.length) throw new Error("Length mismatch");
  if (actual.length === 0) return 0;
  let se = 0;
  for (let i = 0; i < actual.length; i++) se += (predicted[i]! - actual[i]!) ** 2;
  return Math.sqrt(se / actual.length);
}

export function mae(predicted: number[], actual: number[]): number {
  if (predicted.length !== actual.length) throw new Error("Length mismatch");
  if (actual.length === 0) return 0;
  let ae = 0;
  for (let i = 0; i < actual.length; i++) ae += Math.abs(predicted[i]! - actual[i]!);
  return ae / actual.length;
}

export function rSquared(predicted: number[], actual: number[]): number {
  if (predicted.length !== actual.length) throw new Error("Length mismatch");
  if (actual.length === 0) return 0;
  const mean = actual.reduce((a, b) => a + b, 0) / actual.length;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < actual.length; i++) {
    ssTot += (actual[i]! - mean) ** 2;
    ssRes += (actual[i]! - predicted[i]!) ** 2;
  }
  if (ssTot === 0) return 0;
  return 1 - ssRes / ssTot;
}
