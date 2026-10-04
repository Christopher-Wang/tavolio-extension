import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HostedTabPfnPredictor, type HostedTransport } from "@tavolio/models";

/** A fake of the Prior Labs flow that records what was sent. */
function fake(predictions: Record<string, unknown>, status = 200) {
  const calls: Array<{ path: string; body: any }> = [];
  const uploads: string[] = [];
  const transport: HostedTransport = {
    async request(_method, path, body) {
      calls.push({ path, body });
      const info = { signed_urls: ["https://upload.example/x"], required_headers: {} };
      if (status !== 200) return { status, body: { detail: "nope" } };
      if (path === "/tabpfn/prepare_train_set_upload") return { status: 200, body: { train_set_upload_id: "u1", x_train_info: info, y_train_info: info } };
      if (path === "/tabpfn/fit") return { status: 200, body: { fitted_train_set_id: "f1" } };
      if (path === "/tabpfn/prepare_test_set_upload") return { status: 200, body: { test_set_upload_id: "t1", x_test_info: info } };
      return { status: 200, body: { prediction: predictions[(body as any).task_config.predict_params.output_type], metadata: {} } };
    },
    async upload(_url, _headers, body) {
      uploads.push(body);
      return { status: 200 };
    },
  };
  return { transport, calls, uploads };
}

describe("hosted TabPFN predictor", () => {
  it("sends numbers only and maps probabilities onto the class ids present in the context", async () => {
    const { transport, calls, uploads } = fake({ probas: [[0.25, 0.75], [0.5, 0.5]] });
    const p = new HostedTabPfnPredictor(transport);
    // Classes 0..2 exist overall, but the context only has 0 and 2: the API returns two columns.
    const out = await p.predictProba({ cols: 2, trainX: [1, 2, 3, NaN], trainY: [0, 2], testX: [5, 6, 7, 8], numClasses: 3 });
    assert.deepEqual(Array.from(out.probabilities), [0.25, 0, 0.75, 0.5, 0, 0.5]);
    assert.equal(uploads[0], "f0,f1\n1,2\n3,\n");
    assert.equal(uploads[1], "y\n0\n2\n");
    assert.deepEqual(calls.map((c) => c.path), ["/tabpfn/prepare_train_set_upload", "/tabpfn/fit", "/tabpfn/prepare_test_set_upload", "/tabpfn/predict"]);
  });

  it("fits a context once for several chunks", async () => {
    const { transport, calls } = fake({ mean: [1, 2] });
    const p = new HostedTabPfnPredictor(transport);
    const input = { cols: 1, trainX: [1, 2, 3], trainY: [1, 2, 3], testX: [4, 5] };
    await p.predictMean(input);
    await p.predictMean(input);
    assert.equal(calls.filter((c) => c.path === "/tabpfn/fit").length, 1);
  });

  it("asks for the interval's quantiles and orders the bounds", async () => {
    const { transport, calls } = fake({ mean: [1, 2, 3], quantiles: [[0.5, 1.5, 2.5], [1.5, 2.5, 3.5]] });
    const out = await new HostedTabPfnPredictor(transport).predictMean({ cols: 1, trainX: [1, 2], trainY: [1, 2], testX: [3, 4, 5], interval: 0.9 });
    assert.deepEqual(Array.from(out.lower!), [0.5, 1.5, 2.5]);
    assert.deepEqual(Array.from(out.upper!), [1.5, 2.5, 3.5]);
    const q = calls.filter((c) => c.path === "/tabpfn/predict").map((c) => c.body.task_config.predict_params);
    assert.deepEqual(q[1], { output_type: "quantiles", quantiles: [0.05, 0.95] });
  });

  it("explains a rejected key and a malformed answer", async () => {
    await assert.rejects(new HostedTabPfnPredictor(fake({}, 401).transport).predictMean({ cols: 1, trainX: [1], trainY: [1], testX: [2] }), /key was rejected/);
    await assert.rejects(new HostedTabPfnPredictor(fake({ mean: [1] }).transport).predictMean({ cols: 1, trainX: [1, 2], trainY: [1, 2], testX: [3, 4] }), /unexpected shape/);
  });
});
