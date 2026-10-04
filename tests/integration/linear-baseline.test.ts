import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromValues } from "@tavolio/table";
import { fitLinearRegression, fitLogisticRegression } from "@tavolio/models";
import { predictTable } from "@tavolio/prediction";

/** `signal` (repeating, so it isn't taken for an identifier) drives the target; `noise` doesn't. Deterministic. */
function regressionRows(n: number, blanks: number[] = []) {
  const rows: unknown[][] = Array.from({ length: n }, (_, i) => [i % 30, (i * 37) % 11, 10 + 3 * (i % 30) + ((i * 7) % 5) / 10]);
  for (const b of blanks) rows[b]![2] = "";
  return fromValues(["signal", "noise", "price"], rows);
}

function classRows(n: number, blanks: number[] = []) {
  const rows: unknown[][] = Array.from({ length: n }, (_, i) => [i % 20, (i * 37) % 11, i % 20 < 10 ? "low" : "high"]);
  for (const b of blanks) rows[b]![2] = "";
  return fromValues(["signal", "noise", "label"], rows);
}

describe("linear baseline model", () => {
  it("logistic fit gives probabilities that sum to 1, and weights the informative column", () => {
    const x = Array.from({ length: 80 }, (_, i) => [i % 20, (i * 37) % 11]);
    const y = x.map(([a]) => (a! < 10 ? 0 : 1));
    const fit = fitLogisticRegression(x, y, 2);
    for (const p of fit.proba(x.slice(0, 10))) assert.ok(Math.abs(p[0]! + p[1]! - 1) < 1e-9);
    assert.ok(fit.weights[0]! > fit.weights[1]! * 2, JSON.stringify(fit.weights));
    assert.deepEqual(fitLogisticRegression([[1], [1]], [0, 0], 2).proba([[1]]), [[1, 0]]);
  });

  it("linear fit weights the informative column and reports zero for a constant one", () => {
    const x = Array.from({ length: 60 }, (_, i) => [i, (i * 37) % 11, 5]);
    const fit = fitLinearRegression(x, x.map(([a]) => 3 * a! + 1));
    assert.ok(fit.weights[0]! > fit.weights[1]!);
    assert.equal(fit.weights[2], 0);
  });

  it("gives a prediction interval around each predicted value, wider at higher coverage, and none unless asked", async () => {
    const table = regressionRows(120, [5, 50, 99]);
    const narrow = await predictTable({ table, target: "price", interval: 0.5 });
    const wide = await predictTable({ table, target: "price", interval: 0.95 });
    assert.equal(wide.intervalLevel, 0.95);
    for (const b of [5, 50, 99]) {
      const n = narrow.intervals![b]!;
      const w = wide.intervals![b]!;
      assert.ok(w.lower <= (wide.predictions[b] as number) && (wide.predictions[b] as number) <= w.upper);
      assert.ok(w.upper - w.lower > n.upper - n.lower, "95% is wider than 50%");
    }
    assert.equal(wide.intervals![0], null, "known rows get no interval");
    assert.equal((await predictTable({ table, target: "price" })).intervals, undefined);
    assert.equal((await predictTable({ table: classRows(60, [3]), target: "label", interval: 0.95 })).intervals, undefined);
  });

  it("predicts a numeric target with linear regression and says which column mattered", async () => {
    const res = await predictTable({ table: regressionRows(120, [5, 50, 99]), target: "price" });
    assert.equal(res.model?.id, "local-tabular-v1");
    for (const b of [5, 50, 99]) assert.ok(Math.abs(Number(res.predictions[b]) - (10 + 3 * (b % 30))) < 2, `row ${b}: ${res.predictions[b]}`);
    assert.ok(Math.abs((res.predictions[0] as number) - 10.0) < 1e-9, "known rows keep their value");
    assert.equal(res.featureSignals?.[0]?.name, "signal");
    assert.equal(res.featureSignals?.[0]?.strength, 1);
    assert.equal(res.evaluation?.kind, "regression");
    assert.equal(res.evaluation?.baselineKind, "mean");
    assert.ok(res.evaluation!.mae! < res.evaluation!.baselineMae! / 5, "far better than always guessing the average");
  });

  it("predicts a category with logistic regression: probabilities, confidence, and a majority-class reference", async () => {
    const res = await predictTable({ table: classRows(120, [3, 15, 77]), target: "label" });
    assert.equal(res.predictions[3], "low");
    assert.equal(res.predictions[15], "high");
    assert.equal(res.probabilities![3]!.length, 2);
    assert.ok(Math.abs(res.probabilities![3]!.reduce((a, b) => a + b, 0) - 1) < 1e-3);
    assert.ok(res.confidences![3]! > 0.5 && res.confidences![3]! <= 1);
    assert.deepEqual([...res.probabilities![0]!].sort(), [0, 1], "a known row is certain of its own label");
    assert.equal(res.evaluation?.baselineKind, "majority");
    assert.ok(res.evaluation!.accuracy! > 0.9 && res.evaluation!.baselineAccuracy! <= 0.6);
    assert.equal(res.featureSignals?.[0]?.name, "signal");
  });

  it("with nothing to fill, predicts every row from the other rows and says so", async () => {
    const res = await predictTable({ table: classRows(60), target: "label" });
    assert.ok(res.predictions.every((p) => p === "low" || p === "high"));
    assert.ok(res.warnings.some((w) => /no blank cells/i.test(w)));
    const right = res.predictions.filter((p, i) => p === (i % 20 < 10 ? "low" : "high")).length;
    assert.ok(right / 60 > 0.9);
  });
});
