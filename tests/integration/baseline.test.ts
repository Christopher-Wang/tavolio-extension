import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { linearRegressionPredict, logisticRegressionPredict } from "@tavolio/models";

describe("reference regressions", () => {
  it("linear regression recovers a noiseless linear target", () => {
    const x = Array.from({ length: 60 }, (_, i) => [i, (i * 7) % 11]);
    const y = x.map(([a, b]) => 3 * a! - 2 * b! + 5);
    const preds = linearRegressionPredict(x.slice(0, 40), y.slice(0, 40), x.slice(40));
    preds.forEach((p, i) => assert.ok(Math.abs(p - y[40 + i]!) < 0.5, `row ${i}: ${p} vs ${y[40 + i]}`));
  });

  it("logistic regression separates three linearly separable classes", () => {
    const x = Array.from({ length: 90 }, (_, i) => [(i % 3) * 4 + ((i * 13) % 7) / 7, ((i * 5) % 9) / 9]);
    const y = x.map((_, i) => i % 3);
    const preds = logisticRegressionPredict(x.slice(0, 60), y.slice(0, 60), x.slice(60), 3);
    assert.ok(preds.filter((p, i) => p === y[60 + i]).length >= 28);
  });

  it("falls back to the majority class / mean when there is nothing to learn from", () => {
    assert.deepEqual(logisticRegressionPredict([[1], [1], [1]], [0, 1, 1], [[1]], 2), [1]);
    assert.deepEqual(linearRegressionPredict([[2], [2]], [4, 6], [[2]]), [5]);
  });
});
