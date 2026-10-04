import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { OnyxRuntime } from "@tavolio/runtime";
import type { OrtLike } from "@tavolio/runtime";
import { fromValues } from "@tavolio/table";
import { LocalTabularModel, modelRegistry, TabPfnRegressor, TabPfnModel, TABPFN_FAST_MANIFEST } from "@tavolio/models";
import { predictTable } from "@tavolio/prediction";

// Real-model regression tests: `make test-model` (needs tools/tabpfn-export/out built by build_regression.sh + make_regression_parity.py).
const modelPath = process.env.TAVOLIO_REG_MODEL;
const parityPath = process.env.TAVOLIO_REG_PARITY;
const ortDir = process.env.ORT_NODE_DIR;
const skip =
  !modelPath || !existsSync(modelPath) || !parityPath || !existsSync(parityPath) || !ortDir
    ? "real regression model not available (run `make test-model` after building tools/tabpfn-export)"
    : undefined;

interface ParityCase {
  name: string;
  cols: number;
  nTrain: number;
  nTest: number;
  x: Array<number | string>;
  yTrain: number[];
  yTest: number[];
  /** Predicted means in the target's units, from the Python front-end + the same ONNX file under Python onnxruntime. */
  meansF32: number[];
}

const decode = (v: number | string): number => (v === "NaN" ? NaN : (v as number));

describe("TabPFN regression via onnxruntime-node", { skip }, () => {
  const ort = skip ? undefined : (createRequire(join(ortDir!, "package.json"))("onnxruntime-node") as OrtLike);
  const runtime = skip ? undefined : new OnyxRuntime({ ort: ort!, loadModel: async (uri) => ({ model: uri }), executionProviders: ["cpu"] });
  const regressor = skip ? undefined : new TabPfnRegressor(runtime!, modelPath!);
  const cases = skip ? [] : (JSON.parse(readFileSync(parityPath!, "utf8")) as ParityCase[]);

  after(async () => runtime?.dispose());

  for (const c of cases) {
    it(`matches the Python pipeline on "${c.name}" (${c.nTrain} train, ${c.nTest} test, ${c.cols} cols)`, async () => {
      const x = c.x.map(decode);
      const split = c.nTrain * c.cols;
      const { means, latencyMs } = await regressor!.predictMean({ cols: c.cols, trainX: x.slice(0, split), trainY: c.yTrain, testX: x.slice(split) });
      assert.equal(means.length, c.nTest);
      const mean = c.yTrain.reduce((a, b) => a + b, 0) / c.yTrain.length;
      const sd = Math.sqrt(c.yTrain.reduce((a, b) => a + (b - mean) ** 2, 0) / c.yTrain.length);
      let maxDiff = 0;
      for (let r = 0; r < c.nTest; r++) maxDiff = Math.max(maxDiff, Math.abs(means[r]! - c.meansF32[r]!));
      const centre = c.yTest.reduce((a, b) => a + b, 0) / c.nTest;
      const r2 = 1 - c.yTest.reduce((a, v, i) => a + (v - means[i]!) ** 2, 0) / c.yTest.reduce((a, v) => a + (v - centre) ** 2, 0);
      console.log(`    ${c.name}: max |Δ| ${(maxDiff / sd).toExponential(2)} of one std, R² ${r2.toFixed(3)}, ${latencyMs} ms`);
      assert.ok(maxDiff < 0.02 * sd, `predictions differ from the Python pipeline by up to ${maxDiff} (std ${sd})`);
    });
  }
});

describe("TabPFN regression through predictTable (the app's path) with the real model", { skip }, () => {
  it("fills blank numeric targets and beats predicting the average", async () => {
    const ort = createRequire(join(ortDir!, "package.json"))("onnxruntime-node") as OrtLike;
    const runtime = new OnyxRuntime({ ort, loadModel: async (uri) => ({ model: uri }), executionProviders: ["cpu"] });
    const regressor = new TabPfnRegressor(runtime, modelPath!);
    modelRegistry.register(
      new TabPfnModel({
        predictor: { predictProba: async () => { throw new Error("classification isn't used here"); }, predictMean: (i) => regressor.predictMean(i) },
        fallback: new LocalTabularModel(),
      }),
    );

    // 300 rows: price follows a (linear) and score (nonlinear) plus noise (deterministic LCG), a categorical, and some gaps.
    let seed = 777;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
    const blanks = new Set([6, 33, 80, 140, 201, 260]);
    const rows = Array.from({ length: 300 }, (_, i) => {
      const a = i % 23;
      const score = Math.round(rand() * 100);
      const price = 50000 + a * 1200 + Math.sin(score / 12) * 8000 + (rand() - 0.5) * 2000;
      return [a, ["x", "y", "z"][i % 3], i % 13 === 0 ? "" : score, blanks.has(i) ? "" : Math.round(price)];
    });
    const table = fromValues(["a", "plan", "score", "price"], rows);
    const res = await predictTable({ table, target: "price", modelId: TABPFN_FAST_MANIFEST.id, explain: false });
    await runtime.dispose();

    assert.equal(res.model?.id, TABPFN_FAST_MANIFEST.id, `fell back: ${res.notice}`);
    assert.equal(res.notice, undefined);
    assert.deepEqual(res.newRowIndexes, [...blanks].sort((x, y) => x - y));
    for (const b of blanks) {
      const truth = 50000 + (b % 23) * 1200;
      assert.ok(typeof res.predictions[b] === "number" && Math.abs((res.predictions[b] as number) - truth) < 15000, `row ${b}: ${res.predictions[b]} vs ~${truth}`);
    }
    const ev = res.evaluation!;
    console.log(`    held-out MAE ${ev.mae} (linear baseline ${ev.baselineMae}), R² ${ev.r2}`);
    assert.equal(ev.kind, "regression");
    assert.ok(ev.r2! > 0.8, `R² ${ev.r2}`);
    assert.ok(ev.mae! < ev.baselineMae!, "the nonlinear signal should beat a linear fit");
  });
});
