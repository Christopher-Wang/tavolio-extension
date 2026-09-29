export function accuracy(predicted: unknown[], actual: unknown[]): number {
  if (predicted.length !== actual.length) throw new Error("Length mismatch");
  if (actual.length === 0) return 0;
  let correct = 0;
  for (let i = 0; i < actual.length; i++) {
    if (String(predicted[i]) === String(actual[i])) correct++;
  }
  return correct / actual.length;
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
