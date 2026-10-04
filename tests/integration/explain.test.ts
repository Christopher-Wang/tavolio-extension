import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { identityShap, weightedRidge, type ShapQuery } from "@tavolio/models";

/** Runs identityShap against a coalition function f(present, row) -> outputs, counting how many queries it was asked. */
async function run(args: { cells: number[][]; outputs?: number; f: (q: ShapQuery) => number[] }) {
  const features = args.cells[0]!.length;
  let asked = 0;
  const shap = await identityShap({
    rows: args.cells.length,
    features,
    outputs: args.outputs ?? 1,
    key: (row, f) => String(args.cells[row]![f]),
    value: async (qs) => {
      asked = qs.length;
      return qs.flatMap(args.f);
    },
  });
  return { shap, asked };
}

describe("identity-coalition SHAP", () => {
  it("is exact for an additive model", async () => {
    const w = [3, -2, 0.5, 0, 7];
    const cells = [[1, 1, 1, 1, 1]];
    const { shap } = await run({ cells, f: (q) => [1 + q.present.reduce((a, v, j) => a + (v ? w[j]! * cells[q.row]![j]! : 0), 0)] });
    w.forEach((x, j) => assert.ok(Math.abs(shap.phi[0]![j]! - x) < 1e-9, `feature ${j}: ${shap.phi[0]![j]} vs ${x}`));
  });

  it("always sums to f(full) - f(empty), even when interactions break the solo effects", async () => {
    // 0 and 1 only matter together: solo effects are 0, so the whole delta is shared evenly.
    const f = (q: ShapQuery) => [6 * Number(q.present[0] && q.present[1]) + 2 * Number(q.present[2]) + 1];
    const { shap } = await run({ cells: [[1, 1, 1, 1]], f });
    const phi = shap.phi[0]!;
    assert.ok(Math.abs(phi.reduce((a, b) => a + b, 0) - (shap.final[0]! - shap.base[0]!)) < 1e-12);
    assert.equal(shap.final[0]! - shap.base[0]!, 8);
    assert.ok(Math.abs(phi[2]! - (2 + 6 / 4)) < 1e-12, "feature 2: solo 2 + an even quarter of the missed 6");
    assert.ok(Math.abs(phi[0]! - 1.5) < 1e-12 && Math.abs(phi[3]! - 1.5) < 1e-12);
  });

  it("asks once per distinct (feature, value), not per row", async () => {
    // 6 rows, 3 features; column 0 has 2 distinct values, column 1 has 3, column 2 has 1.
    const cells = [[0, 0, 9], [1, 1, 9], [0, 2, 9], [1, 0, 9], [0, 1, 9], [1, 2, 9]];
    const { shap, asked } = await run({ cells, f: (q) => [q.present.reduce((a, v, j) => a + (v ? cells[q.row]![j]! : 0), 0)] });
    assert.equal(asked, 1 + 6 + (2 + 3 + 1));
    assert.equal(shap.evaluations, asked);
    cells.forEach((row, r) => assert.ok(Math.abs(shap.phi[r]!.reduce((a, b) => a + b, 0) - (shap.final[r]! - shap.base[r]!)) < 1e-12));
  });

  it("explains the class the full row scores highest, per row", async () => {
    // Two outputs; feature 0's value decides which output wins.
    const cells = [[0, 5], [1, 5]];
    const f = (q: ShapQuery): number[] => {
      const v = cells[q.row]![0]!;
      return q.present[0] ? (v === 0 ? [0.9, 0.1] : [0.2, 0.8]) : [0.5, 0.5];
    };
    const { shap } = await run({ cells, outputs: 2, f });
    assert.deepEqual(shap.outcome, [0, 1]);
    assert.ok(Math.abs(shap.phi[0]![0]! - 0.4) < 1e-12 && Math.abs(shap.phi[1]![0]! - 0.3) < 1e-12);
    assert.ok(Math.abs(shap.phi[0]![1]!) < 1e-12);
  });

  it("skips the queries whose answers are already known and gives the same values", async () => {
    const w = [3, -2, 0.5];
    const cells = [[1, 2, 3], [4, 5, 6]];
    const f = (q: ShapQuery) => [1 + q.present.reduce((a, v, j) => a + (v ? w[j]! * cells[q.row]![j]! : 0), 0)];
    const plain = await run({ cells, f });
    let asked = 0;
    const known = await identityShap({
      rows: 2,
      features: 3,
      outputs: 1,
      key: (row, j) => String(cells[row]![j]),
      value: async (qs) => {
        asked = qs.length;
        return qs.flatMap(f);
      },
      known: { base: plain.shap.empty, final: (row) => f({ row, present: [true, true, true] }) },
    });
    assert.equal(asked, plain.asked - 3, "no empty query and no full query for either row");
    assert.deepEqual(known.phi, plain.shap.phi);
    assert.deepEqual(known.final, plain.shap.final);
    assert.deepEqual(known.base, plain.shap.base);
  });

  it("handles one feature, no features, and no rows", async () => {
    const one = await run({ cells: [[3]], f: (q) => [q.present[0] ? 5 : 1] });
    assert.deepEqual(one.shap.phi, [[4]]);
    const none = await identityShap({ rows: 2, features: 0, outputs: 1, key: () => "", value: async (qs) => qs.map(() => 7) });
    assert.deepEqual(none.phi, [[], []]);
    const empty = await identityShap({ rows: 0, features: 3, outputs: 1, key: () => "", value: async () => [] });
    assert.deepEqual(empty.phi, []);
  });

  it("weightedRidge with equal weights is plain least squares", () => {
    const x = [[1, 0], [0, 1], [1, 1], [2, 1]];
    const beta = weightedRidge(x, x.map(([a, b]) => 3 * a! - b!), null, 1e-12);
    assert.ok(Math.abs(beta[0]! - 3) < 1e-6 && Math.abs(beta[1]! + 1) < 1e-6);
    const weighted = weightedRidge(x, x.map(([a, b]) => 3 * a! - b!), [1, 5, 2, 0.1], 1e-12);
    assert.ok(Math.abs(weighted[0]! - 3) < 1e-6 && Math.abs(weighted[1]! + 1) < 1e-6);
  });
});
