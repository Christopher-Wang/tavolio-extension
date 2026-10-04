import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RunRequest, RunResult, Runtime } from "@tavolio/runtime";
import { TabPfnClassifier, TabPfnRegressor, TABPFN_LOGIT_WIDTH, TABPFN_REGRESSION_BUCKETS } from "@tavolio/models";

/** A Runtime that records the request and returns the given logits for every test row. */
function fakeRuntime(logitsFor: (row: number) => number[]): Runtime & { last?: RunRequest } {
  const rt: Runtime & { last?: RunRequest } = {
    kind: "cpu",
    async run(request): Promise<RunResult> {
      rt.last = request;
      const nTest = request.inputs["x"]!.dims[1]! - request.inputs["y"]!.dims[0]!;
      const data = new Float32Array(nTest * TABPFN_LOGIT_WIDTH);
      for (let r = 0; r < nTest; r++) data.set(logitsFor(r), r * TABPFN_LOGIT_WIDTH);
      return { outputs: { logits: { name: "logits", dims: [nTest, 1, TABPFN_LOGIT_WIDTH], data } }, runtime: "cpu", latencyMs: 1 };
    },
  };
  return rt;
}

describe("TabPfnClassifier (fake runtime)", () => {
  const input = { cols: 2, trainX: [0, 0, 1, 1, 2, 2], trainY: [0, 1, 0], testX: [5, 5, 6, 6], numClasses: 2 };

  it("feeds the graph (1, rows, cols) features and (n_train, 1) labels, and softmaxes only the first numClasses logits", async () => {
    const rt = fakeRuntime((r) => [r === 0 ? 2 : -2, 0, 99, 99]); // classes beyond numClasses must not leak into the softmax
    const { probabilities } = await new TabPfnClassifier(rt, "m.onnx").predictProba(input);

    const inputs = rt.last!.inputs;
    assert.deepEqual(inputs["x"]!.dims, [1, 5, 2]);
    assert.deepEqual(inputs["nan_ind"]!.dims, [1, 5, 2]);
    assert.deepEqual(inputs["ecdf"]!.dims, [1, 5, 2]);
    assert.deepEqual(inputs["y"]!.dims, [3, 1]);
    assert.deepEqual(Array.from(inputs["y"]!.data as Float32Array), [0, 1, 0]);
    assert.equal(rt.last!.model, "m.onnx");

    assert.equal(probabilities.length, 4);
    const e = Math.exp(2);
    assert.ok(Math.abs(probabilities[0]! - e / (e + 1)) < 1e-6);
    assert.ok(Math.abs(probabilities[0]! + probabilities[1]! - 1) < 1e-6);
    assert.ok(probabilities[2]! < 0.5, "second test row leans to class 1");
  });

  it("fails loudly when the model returns NaN instead of producing predictions", async () => {
    const rt = fakeRuntime(() => [NaN, 0]);
    await assert.rejects(new TabPfnClassifier(rt, "m.onnx").predictProba(input), /invalid numbers/);
  });

  it("is stable with very large logits (no overflow in the softmax)", async () => {
    const rt = fakeRuntime(() => [1e4, -1e4]);
    const { probabilities } = await new TabPfnClassifier(rt, "m.onnx").predictProba(input);
    assert.deepEqual(Array.from(probabilities.slice(0, 2)), [1, 0]);
  });
});

describe("TabPfnRegressor (fake runtime)", () => {
  const input = { cols: 2, trainX: [0, 0, 1, 1, 2, 2, 3, 3], trainY: [10, 20, 30, 40], testX: [5, 5, 6, 6] };

  /** Logits that put all the mass on one bucket per test row. */
  function bucketRuntime(bucketFor: (row: number) => number): Runtime & { last?: RunRequest } {
    const rt: Runtime & { last?: RunRequest } = {
      kind: "cpu",
      async run(request): Promise<RunResult> {
        rt.last = request;
        const nTest = request.inputs["x"]!.dims[1]! - request.inputs["y"]!.dims[0]!;
        const data = new Float32Array(nTest * TABPFN_REGRESSION_BUCKETS).fill(-50);
        for (let r = 0; r < nTest; r++) data[r * TABPFN_REGRESSION_BUCKETS + bucketFor(r)] = 50;
        return { outputs: { logits: { name: "logits", dims: [nTest, 1, TABPFN_REGRESSION_BUCKETS], data } }, runtime: "cpu", latencyMs: 1 };
      },
    };
    return rt;
  }

  it("feeds z-scored targets and maps the bar distribution back to the target's units", async () => {
    const rt = bucketRuntime((r) => (r === 0 ? 2500 : 3000)); // 2500 sits at z≈0, 3000 above it
    const { means } = await new TabPfnRegressor(rt, "r.onnx").predictMean(input);
    const y = Array.from(rt.last!.inputs["y"]!.data as Float32Array);
    assert.deepEqual(rt.last!.inputs["y"]!.dims, [4, 1]);
    assert.ok(Math.abs(y.reduce((a, b) => a + b, 0)) < 1e-5, "mean 0");
    assert.ok(Math.abs(y.reduce((a, b) => a + b * b, 0) / 4 - 1) < 1e-5, "std 1");
    assert.ok(Math.abs(means[0]! - 25) < 0.5, `centre bucket is the target mean, got ${means[0]}`);
    assert.ok(means[1]! > means[0]!, "higher bucket, higher prediction");
  });

  it("answers a constant target without running the model", async () => {
    const rt = bucketRuntime(() => 0);
    const { means } = await new TabPfnRegressor(rt, "r.onnx").predictMean({ ...input, trainY: [7, 7, 7, 7] });
    assert.deepEqual(Array.from(means), [7, 7]);
    assert.equal(rt.last, undefined);
  });

  it("fails loudly on NaN logits", async () => {
    const rt: Runtime = {
      kind: "cpu",
      async run(): Promise<RunResult> {
        return { outputs: { logits: { name: "logits", dims: [2, 1, TABPFN_REGRESSION_BUCKETS], data: new Float32Array(2 * TABPFN_REGRESSION_BUCKETS).fill(NaN) } }, runtime: "cpu", latencyMs: 1 };
      },
    };
    await assert.rejects(new TabPfnRegressor(rt, "r.onnx").predictMean(input), /invalid numbers/);
  });
});
