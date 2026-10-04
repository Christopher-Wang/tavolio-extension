import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { OnyxRuntime } from "@tavolio/runtime";
import type { OrtLike } from "@tavolio/runtime";
import { fromValues } from "@tavolio/table";
import { LocalTabularModel, modelRegistry, TabPfnClassifier, TabPfnModel, TABPFN_FAST_MANIFEST } from "@tavolio/models";
import { predictTable } from "@tavolio/prediction";

// Real-model tests: run via `make test-model` (Debian container with onnxruntime-node + the model built in tools/tabpfn-export/out).
// Anywhere else (e.g. `make test`) they skip, since the weights are neither in the repo nor in the Alpine images.
const modelPath = process.env.TAVOLIO_MODEL;
const parityPath = process.env.TAVOLIO_PARITY;
const ortDir = process.env.ORT_NODE_DIR;
const skip =
  !modelPath || !existsSync(modelPath) || !parityPath || !existsSync(parityPath) || !ortDir
    ? "real model not available (run `make test-model` after building tools/tabpfn-export)"
    : undefined;

interface ParityCase {
  name: string;
  cols: number;
  numClasses: number;
  nTrain: number;
  nTest: number;
  x: Array<number | string>;
  yTrain: number[];
  yTest: number[];
  /** Row-major nTest×numClasses, from the Python front-end + the same ONNX file under Python onnxruntime. */
  probabilities: number[];
}

const decode = (v: number | string): number => (v === "NaN" ? NaN : (v as number));

describe("TabPFN client model via onnxruntime-node", { skip }, () => {
  const ort = skip ? undefined : (createRequire(join(ortDir!, "package.json"))("onnxruntime-node") as OrtLike);
  const runtime = skip ? undefined : new OnyxRuntime({ ort: ort!, loadModel: async (uri) => ({ model: uri }), executionProviders: ["cpu"] });
  const classifier = skip ? undefined : new TabPfnClassifier(runtime!, modelPath!);
  const cases = skip ? [] : (JSON.parse(readFileSync(parityPath!, "utf8")) as ParityCase[]);

  after(async () => runtime?.dispose());

  for (const c of cases) {
    it(`matches the Python pipeline on "${c.name}" (${c.nTrain} train, ${c.nTest} test, ${c.cols} cols, ${c.numClasses} classes)`, async () => {
      const x = c.x.map(decode);
      const split = c.nTrain * c.cols;
      const { probabilities, latencyMs } = await classifier!.predictProba({
        cols: c.cols,
        trainX: x.slice(0, split),
        trainY: c.yTrain,
        testX: x.slice(split),
        numClasses: c.numClasses,
      });
      assert.equal(probabilities.length, c.nTest * c.numClasses);

      let maxDiff = 0;
      let agree = 0;
      let correct = 0;
      for (let r = 0; r < c.nTest; r++) {
        let best = 0;
        let bestRef = 0;
        for (let k = 0; k < c.numClasses; k++) {
          const i = r * c.numClasses + k;
          maxDiff = Math.max(maxDiff, Math.abs(probabilities[i]! - c.probabilities[i]!));
          if (probabilities[i]! > probabilities[r * c.numClasses + best]!) best = k;
          if (c.probabilities[i]! > c.probabilities[r * c.numClasses + bestRef]!) bestRef = k;
        }
        if (best === bestRef) agree++;
        if (best === c.yTest[r]) correct++;
      }
      console.log(`    ${c.name}: max |Δp| ${maxDiff.toExponential(2)}, argmax agreement ${agree}/${c.nTest}, accuracy ${(correct / c.nTest).toFixed(3)}, ${latencyMs} ms`);
      assert.ok(maxDiff < 0.02, `probabilities differ from the Python pipeline by up to ${maxDiff}`);
      assert.equal(agree, c.nTest, "predicted class differs from the Python pipeline");
    });
  }

  it("rejects more classes than the exported graph supports, and inconsistent shapes", async () => {
    await assert.rejects(
      classifier!.predictProba({ cols: 1, trainX: [0, 1], trainY: [0, 1], testX: [0], numClasses: 65 }),
      /2–64 classes/,
    );
    await assert.rejects(
      classifier!.predictProba({ cols: 2, trainX: [0, 1, 2], trainY: [0, 1], testX: [0, 1], numClasses: 2 }),
      /Inconsistent shapes/,
    );
    await assert.rejects(
      classifier!.predictProba({ cols: 1, trainX: [0, 1], trainY: [0, 5], testX: [0], numClasses: 2 }),
      /outside \[0, 2\)/,
    );
  });
});

describe("TabPFN through predictTable (the app's path) with the real model", { skip }, () => {
  it("fills blank targets and scores itself, using the real model rather than the baseline", async () => {
    const ort = createRequire(join(ortDir!, "package.json"))("onnxruntime-node") as OrtLike;
    const runtime = new OnyxRuntime({ ort, loadModel: async (uri) => ({ model: uri }), executionProviders: ["cpu"] });
    modelRegistry.register(
      new TabPfnModel({ predictor: new TabPfnClassifier(runtime, modelPath!), fallback: new LocalTabularModel() }),
    );

    // 300 rows: the label follows column "a" with ~10% label noise (deterministic LCG), plus a categorical and a numeric with gaps.
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
    const blanks = new Set([4, 40, 77, 120, 190, 250, 299]);
    const rows = Array.from({ length: 300 }, (_, i) => {
      const a = i % 17;
      const truth = a < 8 ? "low" : "high";
      const label = rand() < 0.1 ? (truth === "low" ? "high" : "low") : truth;
      return [a, Math.floor(i / 17), ["x", "y", "z"][i % 3], i % 11 === 0 ? "" : Math.round(rand() * 100), blanks.has(i) ? "" : label];
    });
    const table = fromValues(["a", "b", "plan", "score", "label"], rows);

    const stages: string[] = [];
    const res = await predictTable({ table, target: "label", modelId: TABPFN_FAST_MANIFEST.id, onProgress: (s) => void stages.push(s) });
    await runtime.dispose();

    assert.equal(res.model?.id, TABPFN_FAST_MANIFEST.id, `fell back: ${res.notice}`);
    assert.equal(res.notice, undefined);
    assert.deepEqual(res.newRowIndexes, [...blanks].sort((x, y) => x - y));
    for (const b of blanks) {
      const expected = (b % 17) < 8 ? "low" : "high";
      assert.ok(res.predictions[b] === "low" || res.predictions[b] === "high");
      assert.ok(res.confidences![b]! > 0.5 && res.confidences![b]! <= 1);
      if (res.predictions[b] !== expected) console.log(`    note: blank row ${b} predicted ${res.predictions[b]}, signal says ${expected}`);
    }
    const ev = res.evaluation!;
    console.log(`    held-out accuracy ${ev.accuracy} vs baseline ${ev.baselineAccuracy}`);
    assert.ok(ev.accuracy! > ev.baselineAccuracy!, "the model should beat predicting the majority class on a signal this clear");
    assert.ok(ev.accuracy! >= 0.8);
    assert.ok(res.featureSignals && res.featureSignals[0]!.name === "a", "column a carries the signal");
    assert.deepEqual(stages, ["preparing", "predicting", "evaluating"], "no loading stage when the model has nothing to download");
  });

  it("predicts multi-class targets: a 4-way category and a 1-5 rating, not just yes/no", async () => {
    const ort = createRequire(join(ortDir!, "package.json"))("onnxruntime-node") as OrtLike;
    const runtime = new OnyxRuntime({ ort, loadModel: async (uri) => ({ model: uri }), executionProviders: ["cpu"] });
    modelRegistry.register(
      new TabPfnModel({ predictor: new TabPfnClassifier(runtime, modelPath!), fallback: new LocalTabularModel() }),
    );
    let seed = 777;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
    const regions = ["north", "south", "east", "west"];
    const blanks = new Set([3, 50, 99, 141, 222, 280]);
    const rows = Array.from({ length: 300 }, (_, i) => {
      const a = i % 20;
      const k = Math.floor(a / 5);                           // 4 classes, 5 values of `a` each
      const noisy = rand() < 0.08 ? Math.floor(rand() * 4) : k;
      return [a, Math.round(rand() * 100), regions[noisy], blanks.has(i) ? "" : regions[noisy], noisy + 1];
    });
    const table = fromValues(["a", "noise", "region_truth", "region", "rating"], rows);

    for (const [target, drop] of [["region", "region_truth"], ["rating", "region_truth"]] as const) {
      const cols = table.columns.filter((c) => c.name !== drop && c.name !== (target === "region" ? "rating" : "region"));
      const idx = cols.map((c) => table.columns.findIndex((t) => t.name === c.name));
      const sub = { columns: cols, rows: table.rows.map((r) => idx.map((j) => r[j])) };
      if (target === "rating") for (const b of blanks) sub.rows[b]![cols.findIndex((c) => c.name === "rating")] = "";
      const res = await predictTable({ table: sub as typeof table, target, modelId: TABPFN_FAST_MANIFEST.id });
      assert.equal(res.model?.id, TABPFN_FAST_MANIFEST.id, `${target} fell back: ${res.notice}`);
      assert.equal(res.task.type, "classification");
      assert.equal((res.task as { classes: string[] }).classes.length, 4);
      for (const b of blanks) {
        assert.equal(res.probabilities![b]!.length, 4, "a probability per class");
        assert.ok(Math.abs(res.probabilities![b]!.reduce((x, y) => x + y, 0) - 1) < 0.02);
      }
      const accuracy = res.evaluation!.accuracy!;
      console.log(`    ${target}: 4 classes, held-out accuracy ${accuracy} vs baseline ${res.evaluation!.baselineAccuracy}`);
      assert.ok(accuracy >= 0.8 && accuracy > res.evaluation!.baselineAccuracy! + 0.3);
    }
    await runtime.dispose();
  });
});
