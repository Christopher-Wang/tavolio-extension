import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applySchema, inferSchema } from "@tavolio/preprocessing";
import { fromValues } from "@tavolio/table";
import {
  encodeForTabPfn,
  LocalTabularModel,
  modelRegistry,
  TabPfnModel,
  type LoadProgress,
  type TabPfnInput,
  type TabPfnModelOptions,
  type TabPfnOutput,
  type TabPfnPredictor,
  type TabPfnRegressionInput,
  type TabPfnRegressionOutput,
} from "@tavolio/models";
import { predictTable, type PredictStage } from "@tavolio/prediction";

/**
 * 1-NN on the integer column with the most distinct values ("a": preprocessing shuffles column order, so it can't be addressed by
 * position), 0.9 on the neighbour's class. Records every call and whether a test row also appeared in the context (rows are
 * compared whole: the fingerprint column makes a row's full vector identify it).
 */
class StubPredictor implements TabPfnPredictor {
  calls: Array<{ nTrain: number; nTest: number; cols: number; numClasses: number }> = [];
  leaked = false;

  /** Regression: the target of the nearest training row on the same column, for the same leak bookkeeping. */
  async predictMean(input: TabPfnRegressionInput): Promise<TabPfnRegressionOutput> {
    const { cols } = input;
    const nTrain = input.trainY.length;
    const nTest = input.testX.length / cols;
    this.calls.push({ nTrain, nTest, cols, numClasses: 0 });
    const key = (x: ArrayLike<number>, r: number) => Array.from({ length: cols }, (_, c) => x[r * cols + c]).join(",");
    const distinctInts = (c: number) =>
      new Set(Array.from({ length: nTrain }, (_, r) => input.trainX[r * cols + c]!).filter((v) => Number.isInteger(v))).size;
    const col = Array.from({ length: cols }, (_, c) => c).sort((a, b) => distinctInts(b) - distinctInts(a))[0]!;
    const trainKeys = new Set(Array.from({ length: nTrain }, (_, r) => key(input.trainX, r)));
    const means = new Float64Array(nTest);
    for (let r = 0; r < nTest; r++) {
      if (trainKeys.has(key(input.testX, r))) this.leaked = true;
      let best = 0;
      for (let t = 1; t < nTrain; t++) {
        if (Math.abs(input.trainX[t * cols + col]! - input.testX[r * cols + col]!) < Math.abs(input.trainX[best * cols + col]! - input.testX[r * cols + col]!)) best = t;
      }
      means[r] = input.trainY[best]!;
    }
    return { means, latencyMs: 0 };
  }

  async predictProba(input: TabPfnInput): Promise<TabPfnOutput> {
    const { cols, numClasses: k } = input;
    const nTrain = input.trainY.length;
    const nTest = input.testX.length / cols;
    this.calls.push({ nTrain, nTest, cols, numClasses: k });
    const key = (x: ArrayLike<number>, r: number) => Array.from({ length: cols }, (_, c) => x[r * cols + c]).join(",");
    const distinctInts = (c: number) =>
      new Set(Array.from({ length: nTrain }, (_, r) => input.trainX[r * cols + c]!).filter((v) => Number.isInteger(v))).size;
    const col = Array.from({ length: cols }, (_, c) => c).sort((a, b) => distinctInts(b) - distinctInts(a))[0]!;
    const trainKeys = new Set(Array.from({ length: nTrain }, (_, r) => key(input.trainX, r)));
    const probabilities = new Float32Array(nTest * k).fill(0.1 / Math.max(1, k - 1));
    for (let r = 0; r < nTest; r++) {
      if (trainKeys.has(key(input.testX, r))) this.leaked = true;
      let best = 0;
      for (let t = 1; t < nTrain; t++) {
        if (Math.abs(input.trainX[t * cols + col]! - input.testX[r * cols + col]!) < Math.abs(input.trainX[best * cols + col]! - input.testX[r * cols + col]!)) best = t;
      }
      probabilities[r * k + input.trainY[best]!] = 0.9;
    }
    return { probabilities, latencyMs: 0 };
  }
}

/** a = i % 17 and b = i / 17 are each repeated but identify the row together; label depends on a. */
function classificationTable(n: number, blanks: number[] = []) {
  const rows = Array.from({ length: n }, (_, i) => [i % 17, Math.floor(i / 17), ["x", "y", "z"][i % 3], i % 17 < 8 ? "low" : "high"]);
  for (const b of blanks) rows[b]![3] = "";
  return fromValues(["a", "b", "plan", "label"], rows);
}

function regressionTable(n: number) {
  return fromValues(["a", "b", "price"], Array.from({ length: n }, (_, i) => [i % 17, Math.floor(i / 17), 100 + i * 3.7]));
}

function manyClassesTable(classes: number) {
  return fromValues(["a", "b", "label"], Array.from({ length: classes * 2 }, (_, i) => [i % 17, Math.floor(i / 17), `c${i % classes}`]));
}

function register(options: Partial<TabPfnModelOptions> = {}) {
  const predictor = new StubPredictor();
  const model = new TabPfnModel({ predictor, fallback: new LocalTabularModel(), ...options });
  modelRegistry.register(model);
  return { predictor, model };
}

const run = (table: ReturnType<typeof classificationTable>, target: string, extra: Partial<Parameters<typeof predictTable>[0]> = {}) =>
  predictTable({ table, target, modelId: "tabpfn-fast-v1", ...extra });

describe("TabPfnModel (stub predictor)", () => {
  it("fills blank targets with all labeled rows as context, and scores a held-out split first", async () => {
    const { predictor } = register();
    const blanks = [3, 10, 25];
    const res = await run(classificationTable(60, blanks), "label");

    assert.equal(res.model?.id, "tabpfn-fast-v1");
    assert.deepEqual(res.newRowIndexes, blanks);
    for (const b of blanks) assert.ok(["low", "high"].includes(String(res.predictions[b])), `row ${b}: ${res.predictions[b]}`);
    assert.equal(res.predictions[0], "low", "rows whose label is known keep it");
    assert.equal(res.confidences?.[blanks[0]!], 0.9);
    assert.equal(res.confidences?.[0], 1);
    assert.ok(res.evaluation && res.evaluation.accuracy! > 0.9 && res.evaluation.baselineAccuracy! <= 1);
    assert.equal(res.validation, "random");

    assert.equal(predictor.calls.length, 2);
    assert.deepEqual([predictor.calls[0]!.nTrain, predictor.calls[0]!.nTest], [40, 17], "70/30 split of the 57 labeled rows");
    assert.deepEqual([predictor.calls[1]!.nTrain, predictor.calls[1]!.nTest], [57, 3], "final run: every labeled row as context");
    assert.equal(predictor.calls[0]!.numClasses, 2);
  });

  it("with nothing to fill, predicts every row out-of-fold, never showing a row its own label", async () => {
    const { predictor } = register();
    const res = await run(classificationTable(60), "label");
    assert.equal(predictor.leaked, false);
    assert.equal(res.predictions.length, 60);
    assert.ok(res.predictions.every((p) => p === "low" || p === "high"));
    assert.ok(res.warnings.some((w) => /no blank cells/i.test(w)));
    assert.equal(predictor.calls.length, 4, "1 evaluation run + 3 folds");
  });

  it("skips scoring on validation none, and holds out exactly the selected rows on selection", async () => {
    let { predictor } = register();
    let res = await run(classificationTable(60, [5]), "label", { validation: { kind: "none" } });
    assert.equal(res.evaluation, undefined);
    assert.equal(predictor.calls.length, 1);

    ({ predictor } = register());
    res = await run(classificationTable(60, [5]), "label", { validation: { kind: "selection", rows: [0, 1, 2, 3] } });
    assert.equal(predictor.calls[0]!.nTest, 4);
    assert.equal(predictor.calls[0]!.nTrain, 55);
    assert.equal(res.validation, "selection");
  });

  it("caps context rows and chunks test rows", async () => {
    const { predictor } = register({ maxContextRows: 10, chunkRows: 2 });
    const res = await run(classificationTable(60, [1, 2, 3, 4, 5]), "label");
    assert.ok(predictor.calls.every((c) => c.nTrain <= 10 && c.nTest <= 2), JSON.stringify(predictor.calls));
    assert.ok(res.warnings.some((w) => /random 10 of 55/.test(w)));
  });

  it("predicts a numeric target: fills blanks from the known rows and scores a held-out split against a linear fit", async () => {
    const { predictor } = register();
    const table = regressionTable(60) as never;
    const blanks = [4, 20];
    const col = (table as { rows: unknown[][] }).rows;
    const withBlanks = fromValues(["a", "b", "price"], col.map((r, i) => [r[0], r[1], blanks.includes(i) ? "" : r[2]]) as never);
    const res = await run(withBlanks, "price");
    assert.equal(res.model?.id, "tabpfn-fast-v1");
    assert.equal(res.notice, undefined);
    assert.equal(res.task.type, "regression");
    assert.equal(res.probabilities, undefined);
    assert.ok(blanks.every((i) => typeof res.predictions[i] === "number" && Number.isFinite(res.predictions[i] as number)));
    assert.equal(res.predictions[0], 100, "known targets are kept");
    assert.equal(res.evaluation?.kind, "regression");
    assert.ok(res.evaluation!.mae! >= 0 && res.evaluation!.rmse! >= res.evaluation!.mae!);
    assert.ok(res.evaluation!.baselineMae! >= 0);
    assert.equal(predictor.calls.length, 2, "1 evaluation run + 1 fill");
    assert.equal(predictor.leaked, false, "no test row appears in its own context");
  });

  it("ranks columns for a numeric target when asked to explain, and explains single rows in the target's units", async () => {
    register();
    const rows = (regressionTable(60) as { rows: unknown[][] }).rows;
    const blanks = [4, 20];
    const table = fromValues(["a", "b", "price"], rows.map((r, i) => [r[0], r[1], blanks.includes(i) ? "" : r[2]]) as never);
    const res = await run(table, "price", { explain: true });
    assert.equal(res.model?.id, "tabpfn-fast-v1");
    assert.ok(res.explanation, "explained");
    assert.ok(res.featureSignals!.length > 0);
    assert.ok(res.explainRow, "regression explains single rows too");
    const row = blanks[0]!;
    const e = await res.explainRow!(row);
    assert.equal(e.outcome, "price");
    assert.ok(Math.abs(e.base + e.contributions.reduce((a, c) => a + c.phi, 0) - e.final) < 1e-3, "base + pushes = the predicted value");
    assert.ok(Math.abs(e.final - Number(res.predictions[row])) < 1e-6 * Math.max(1, Math.abs(e.final)) + 1e-3, "final is the row's prediction");
  });

  it("loads the regression graph for a numeric target, not the classification one", async () => {
    const kinds: string[] = [];
    register({ ensureReady: async (_p, task) => (kinds.push(task), null) });
    await run(regressionTable(40) as never, "price");
    assert.deepEqual([...new Set(kinds)], ["regression"]);
  });

  it("falls back to the baseline for regression when the engine has no regression graph, without loading anything", async () => {
    let loads = 0;
    const predictor = new StubPredictor();
    const noMean: TabPfnPredictor = { predictProba: (i) => predictor.predictProba(i) };
    modelRegistry.register(new TabPfnModel({ predictor: noMean, fallback: new LocalTabularModel(), ensureReady: async () => (loads++, null) }));
    const res = await run(regressionTable(40) as never, "price");
    assert.equal(res.model?.id, "local-tabular-v1");
    assert.match(res.notice!, /instead of TabPFN Fast: this device has no regression model/);
    assert.equal(predictor.calls.length, 0);
    assert.equal(loads, 0, "no download for a table TabPFN won't handle");
  });

  it("falls back when the column has more outcomes than the model supports", async () => {
    const { predictor } = register();
    const res = await run(manyClassesTable(70) as never, "label");
    assert.equal(res.model?.id, "local-tabular-v1");
    assert.match(res.notice!, /up to 64 outcomes and this column has 70/);
    assert.equal(predictor.calls.length, 0);
  });

  it("falls back with the device's reason when the engine isn't available, and retries next run", async () => {
    let attempts = 0;
    const { predictor } = register({ ensureReady: async () => (attempts++, "this browser has no WebGPU") });
    for (let i = 0; i < 2; i++) {
      const res = await run(classificationTable(30, [2]), "label");
      assert.equal(res.model?.id, "local-tabular-v1");
      assert.match(res.notice!, /this browser has no WebGPU/);
    }
    assert.equal(attempts, 2, "an unavailable engine is re-checked, so a transient failure heals");
    assert.equal(predictor.calls.length, 0);
  });

  it("starts the engine once while it works, and reports download progress as a loading stage", async () => {
    let starts = 0;
    const { predictor } = register({
      ensureReady: async (onProgress) => {
        starts++;
        onProgress?.({ phase: "download", loaded: 5, total: 10 });
        return null;
      },
    });
    const seen: Array<[PredictStage, LoadProgress | undefined]> = [];
    await run(classificationTable(30, [2]), "label", { onProgress: (s, d) => void seen.push([s, d]) });
    await run(classificationTable(30, [2]), "label");
    assert.equal(starts, 1);
    assert.ok(predictor.calls.length >= 4);
    assert.deepEqual(
      seen.map(([s]) => s),
      ["preparing", "loading-model", "predicting", "evaluating", "baseline"],
    );
    assert.deepEqual(seen[1]![1], { phase: "download", loaded: 5, total: 10 });
  });

  it("falls back, with the error, when the model run fails", async () => {
    const failing: TabPfnPredictor = { predictProba: async () => Promise.reject(new Error("out of GPU memory")) };
    register({ predictor: failing });
    const res = await run(classificationTable(30, [2]), "label");
    assert.equal(res.model?.id, "local-tabular-v1");
    assert.match(res.notice!, /failed while running \(out of GPU memory\)/);
  });
});

describe("encodeForTabPfn", () => {
  it("keeps numbers as numbers, missing as NaN, categories as ordinal codes, dates as index + Fourier terms, and drops identifiers", () => {
    const table = fromValues(
      ["id", "n", "cat", "when", "flag", "y"],
      [
        ["r1", 1.5, "pro", "2024-01-01", "TRUE", "a"],
        ["r2", "", "basic", "2024-01-03", "false", "b"],
        ["r3", 3, "pro", "", "true", "a"],
        ["r4", 4, "", "2024-01-02", "FALSE", "b"],
        ["r5", 1.5, "basic", "2024-01-01", "TRUE", "a"],
        ["r6", 3, "pro", "2024-01-03", "false", "b"],
        ["r7", 4, "basic", "2024-01-02", "true", "a"],
        ["r8", 3, "pro", "2024-01-01", "FALSE", "b"],
      ],
    );
    const withSchema = applySchema(table, inferSchema(table));
    const frame = encodeForTabPfn(withSchema, withSchema.columns, "y");
    const names = frame.featureNames;
    assert.ok(!names.includes("id"), "the unique-per-row id column is excluded");
    assert.ok(!names.includes("y"));
    const at = (r: number, name: string) => frame.matrix[r * frame.cols + names.indexOf(name)]!;
    assert.equal(at(0, "n"), 1.5);
    assert.ok(Number.isNaN(at(1, "n")));
    assert.deepEqual([at(0, "cat"), at(1, "cat")].sort(), [0, 1], "two categories -> codes 0 and 1");
    assert.equal(at(0, "cat"), at(2, "cat"));
    assert.ok(Number.isNaN(at(3, "cat")));
    assert.equal(at(1, "when (days)") - at(0, "when (days)"), 2, "running index counts days from the earliest date");
    assert.equal(at(0, "when (days)"), 0);
    assert.ok(Number.isNaN(at(2, "when (days)")) && Number.isNaN(at(2, "when (annual sin1)")));
    assert.ok(!names.some((n) => n.includes("daily")), "whole dates have a constant daily cycle, which is dropped");
    assert.equal(at(0, "flag"), at(2, "flag"), "TRUE and true are the same value");
    assert.notEqual(at(0, "flag"), at(1, "flag"));
    assert.equal(frame.categorical[names.indexOf("cat")], true);
    assert.equal(frame.categorical[names.indexOf("n")], false);
  });
});

describe("TabPfnModel explanations (stub predictor)", () => {
  it("ranks the column the model actually uses first, labelled as an explanation, through the same predictor", async () => {
    const { predictor } = register();
    const stages: PredictStage[] = [];
    const res = await run(classificationTable(80, [3, 10]), "label", { explain: true, onProgress: (st) => void stages.push(st) });
    assert.ok(res.explanation && res.explanation.method === "identity-shap");
    assert.equal(res.explanation.rows, 2, "only the two predicted (blank-target) rows are explained, not held-out ones");
    assert.ok(res.explanation.evaluations > 0);
    assert.equal(res.featureSignals?.[0]?.name, "a");
    assert.equal(res.featureSignals?.[0]?.strength, 1);
    assert.ok(res.featureSignals!.every((s) => s.strength >= 0 && s.strength <= 1));
    assert.ok(!stages.includes("explaining" as never), "no separate explaining step: the ranking is part of evaluating");
    const batch = Math.max(...predictor.calls.slice(2).map((c) => c.nTest));
    assert.ok(batch > 0 && batch <= 1 + res.explanation.rows * res.featureSignals!.length, `identity coalitions only; the empty answer plus one per feature value; the rows' own predictions aren't asked again (${batch})`);
  });

  it("does nothing extra when not asked", async () => {
    const { predictor } = register();
    const stages: PredictStage[] = [];
    const res = await run(classificationTable(80, [3, 10]), "label", { onProgress: (s) => void stages.push(s) });
    assert.equal(res.explanation, undefined);
    assert.equal(predictor.calls.length, 2);
  });

  it("says so when the baseline ran instead and keeps the quick ranking", async () => {
    register();
    const res = await run(manyClassesTable(70) as never, "label", { explain: true });
    assert.equal(res.explanation, undefined);
    assert.ok(res.warnings.some((w) => /Explanations need TabPFN Fast/.test(w)));
  });

  it("explains one clicked row: base + pushes = the probability, the used column pushes most, results are cached", async () => {
    const { predictor } = register();
    const blanks = [3, 10, 25];
    const res = await run(classificationTable(80, blanks), "label", { explain: true });
    const featureSignals = res.featureSignals;
    assert.ok(featureSignals!.every((s) => typeof s.impact === "number" && s.impact >= 0 && s.impact <= 1));
    assert.equal(featureSignals![0]!.impact! >= featureSignals![1]!.impact!, true);
    assert.ok(featureSignals!.every((s) => s.spread && s.spread.min >= 0 && s.spread.max >= s.spread.min && s.spread.std >= 0), "every driver carries min/max/std of |shap|");

    const many = await res.explainRows!(blanks);
    assert.deepEqual(many.map((m) => m.row), blanks);
    for (const m of many) {
      assert.ok(m.contributions.length > 0);
      assert.ok(Math.abs(m.base + m.contributions.reduce((a, c) => a + c.phi, 0) - m.final) < 1e-3, "base + pushes = final");
    }

    const before = predictor.calls.length;
    const e = await res.explainRow!(10);
    assert.equal(e.row, 10);
    assert.equal(e.outcome, res.predictions[10]);
    const total = e.contributions.reduce((a, c) => a + c.phi, 0);
    assert.ok(Math.abs(e.base + total - e.final) < 1e-3, `${e.base} + ${total} vs ${e.final}`);
    assert.equal(e.contributions[0]!.name, "a");
    assert.ok(e.contributions.every((c, i, all) => i === 0 || Math.abs(all[i - 1]!.phi) >= Math.abs(c.phi)));
    assert.ok(e.final > e.base, "the column the model uses pushes the predicted class up");
    const after = predictor.calls.length;
    assert.ok(after > before);
    assert.equal(await res.explainRow!(10), await res.explainRow!(10));
    assert.equal(predictor.calls.length, after, "a second ask for the same row doesn't call the model again");
    await assert.rejects(() => res.explainRow!(9999), /no row 10000/);
  });

  it("has no explainRow unless explanations were asked for", async () => {
    register();
    const res = await run(classificationTable(80, [3]), "label");
    assert.equal(res.explainRow, undefined);
  });
});
