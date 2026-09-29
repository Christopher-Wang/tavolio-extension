import { isMissingValue } from "@tavolio/preprocessing";
import { accuracy, mae, majorityBaselineAccuracy, meanBaselineMae, rSquared, rmse } from "./metrics.js";
import { toRegressionTarget } from "./regression.js";

export interface ClassificationEvaluation {
  kind: "classification";
  accuracy: number;
  baselineAccuracy: number;
  /** Share of held-out rows the model got right (0..1). */
  heldOut: number;
}

export interface RegressionEvaluation {
  kind: "regression";
  mae: number;
  rmse: number;
  r2: number;
  baselineMae: number;
  /** Share of held-out rows evaluated (0..1). */
  heldOut: number;
}

export type Evaluation = ClassificationEvaluation | RegressionEvaluation;

/**
 * Holdout evaluation behind one entry point (§6, §9).
 * Splits labeled rows 70/30 with a deterministic shuffle, scores the
 * caller's predictor on the held-out slice, and compares against the
 * dumb baseline (majority class / mean target).
 */
export function evaluateHoldout(args: {
  targets: unknown[];
  predict: (trainIdx: number[], testIdx: number[]) => unknown[];
  task: "classification" | "regression";
  seed?: number;
}): Evaluation {
  const { targets, predict, task } = args;
  const seed = args.seed ?? 42;
  const labeledIdx = targets
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => !isMissingValue(v) && (task === "classification" || toRegressionTarget(v) !== null))
    .map(({ i }) => i);
  if (labeledIdx.length < 4) {
    return task === "classification"
      ? { kind: "classification", accuracy: 0, baselineAccuracy: 0, heldOut: 0 }
      : { kind: "regression", mae: 0, rmse: 0, r2: 0, baselineMae: 0, heldOut: 0 };
  }
  const shuffled = shuffle([...labeledIdx], seed);
  const split = Math.max(1, Math.floor(shuffled.length * 0.7));
  const trainIdx = shuffled.slice(0, split);
  const testIdx = shuffled.slice(split);
  const preds = predict(trainIdx, testIdx);
  const actual = testIdx.map((i) => targets[i]);

  if (task === "classification") {
    const acc = accuracy(preds, actual);
    return {
      kind: "classification",
      accuracy: round4(acc),
      baselineAccuracy: round4(majorityBaselineAccuracy(actual)),
      heldOut: round4(testIdx.length / labeledIdx.length),
    };
  }
  const predNums = preds.map((p) => (typeof p === "number" ? p : Number(p)));
  const actNums = actual.map((v) => toRegressionTarget(v)!);
  return {
    kind: "regression",
    mae: round4(mae(predNums, actNums)),
    rmse: round4(rmse(predNums, actNums)),
    r2: round4(rSquared(predNums, actNums)),
    baselineMae: round4(meanBaselineMae(actNums)),
    heldOut: round4(testIdx.length / labeledIdx.length),
  };
}

/** Deterministic PRNG shuffle so metrics are stable across runs. */
function shuffle<T>(arr: T[], seed: number): T[] {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
