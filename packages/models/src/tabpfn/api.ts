import type { ModelManifest } from "../types.js";
import type { TabPfnInput, TabPfnOutput } from "./classifier.js";
import type { TabPfnRegressionInput, TabPfnRegressionOutput } from "./regressor.js";
import type { TabPfnPredictor } from "./model.js";

/** TabPFN through Prior Labs' hosted API: the same front-end and fallbacks as the on-device model, but the table is sent to their servers. */
export const TABPFN_API_MANIFEST: ModelManifest = {
  id: "tabpfn-api-v1",
  displayName: "TabPFN (API)",
  version: "3.5",
  taskKinds: ["classification", "regression"],
  preferredRuntime: "remote",
};

/** `model_path` the fit request asks for (the value Prior Labs' quickstart uses for TabPFN-3.5). */
const FIT_MODEL = "v3.5_default";

/**
 * How requests reach api.priorlabs.ai. The API only allows its own web origins, so a Sheets sidebar can't call it from the page;
 * the host (Apps Script) makes the calls and holds the key, which therefore never reaches this code.
 */
export interface HostedTransport {
  /** A JSON call to the API. Resolves whatever status came back; rejects only when the request couldn't be made. */
  request(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  /** PUT a file to a signed upload URL (not an API call, so no key goes with it). */
  upload(url: string, headers: Record<string, string>, body: string): Promise<{ status: number }>;
}

/** The user's own Prior Labs key, kept by the host per user. */
export interface ApiKeyStore {
  has(): Promise<boolean>;
  set(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface UploadInfo {
  signed_urls: string[];
  required_headers: Record<string, string>;
}

/** NaN cells are left empty, which the API reads as missing. */
function csv(header: string, rows: ArrayLike<number>, cols: number): string {
  const n = rows.length / cols;
  const names = Array.from({ length: cols }, (_, j) => `${header}${j}`).join(",");
  const lines = [names];
  for (let r = 0; r < n; r++) {
    const cells: string[] = new Array(cols);
    for (let j = 0; j < cols; j++) {
      const v = rows[r * cols + j]!;
      cells[j] = Number.isNaN(v) ? "" : String(v);
    }
    lines.push(cells.join(","));
  }
  return lines.join("\n") + "\n";
}

/** FNV-1a over the text, to recognise a context that was already fitted. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

function failure(status: number, body: unknown): Error {
  const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : "";
  if (status === 401) return new Error("the Prior Labs API key was rejected");
  if (status === 429) return new Error("the Prior Labs rate limit or quota was reached");
  return new Error(`the Prior Labs API answered ${status}${detail ? `: ${detail}` : ""}`);
}

/**
 * Runs `TabPfnModel`'s calls on the hosted API: upload the context, fit it, upload the rows to predict, predict.
 * Rows arrive already numeric (ordinal-coded categoricals, dates expanded), so every column goes up as a number.
 */
export class HostedTabPfnPredictor implements TabPfnPredictor {
  /** Fitted contexts by content: a big prediction goes in several chunks, all against the same context, and is fitted once. */
  private fits = new Map<string, Promise<string>>();

  constructor(private readonly transport: HostedTransport) {}

  private async call<T>(path: string, body: unknown): Promise<T> {
    const { status, body: out } = await this.transport.request("POST", path, body);
    if (status < 200 || status >= 300) throw failure(status, out);
    return out as T;
  }

  private async put(info: UploadInfo, text: string): Promise<void> {
    const url = info.signed_urls[0];
    if (!url) throw new Error("the Prior Labs API gave no upload address");
    const { status } = await this.transport.upload(url, info.required_headers, text);
    if (status < 200 || status >= 300) throw new Error(`uploading the table failed (${status})`);
  }

  private fit(task: "classification" | "regression", x: string, y: string): Promise<string> {
    const key = `${task}:${x.length}:${fnv(x)}:${fnv(y)}`;
    let fitted = this.fits.get(key);
    if (!fitted) {
      fitted = (async () => {
        const up = await this.call<{ train_set_upload_id: string; x_train_info: UploadInfo; y_train_info: UploadInfo }>("/tabpfn/prepare_train_set_upload", {
          x_train_info: { format: "csv" },
          y_train_info: { format: "csv" },
        });
        await Promise.all([this.put(up.x_train_info, x), this.put(up.y_train_info, y)]);
        const fit = await this.call<{ fitted_train_set_id: string }>("/tabpfn/fit", {
          train_set_upload_id: up.train_set_upload_id,
          task,
          tabpfn_config: { model_path: FIT_MODEL },
        });
        return fit.fitted_train_set_id;
      })();
      this.fits.set(key, fitted);
      // Only the latest few contexts are worth keeping (a run has one for the held-out check and one for the real thing).
      if (this.fits.size > 4) this.fits.delete(this.fits.keys().next().value!);
      fitted.catch(() => this.fits.delete(key));
    }
    return fitted;
  }

  /** Uploads the rows to predict and runs `predict` for each requested output on the same fit. */
  private async predict(
    task: "classification" | "regression",
    trainX: string,
    trainY: string,
    testX: string,
    outputs: Array<Record<string, unknown>>,
  ): Promise<unknown[]> {
    const fitted = await this.fit(task, trainX, trainY);
    const up = await this.call<{ test_set_upload_id: string; x_test_info: UploadInfo }>("/tabpfn/prepare_test_set_upload", {
      fitted_train_set_id: fitted,
      x_test_info: { format: "csv" },
    });
    await this.put(up.x_test_info, testX);
    const results: unknown[] = [];
    for (const predict_params of outputs) {
      const res = await this.call<{ prediction: unknown }>("/tabpfn/predict", {
        test_set_upload_id: up.test_set_upload_id,
        fitted_train_set_id: fitted,
        task_config: { task, tabpfn_config: { model_path: "auto" }, predict_params },
      });
      results.push(res.prediction);
    }
    return results;
  }

  async predictProba(input: TabPfnInput): Promise<TabPfnOutput> {
    const started = Date.now();
    const { cols, numClasses: k } = input;
    const nTest = input.testX.length / cols;
    // The API returns one column per class that occurs in the context, in ascending order; the rest get probability 0.
    const present = [...new Set(Array.from(input.trainY))].sort((a, b) => a - b);
    const [prediction] = await this.predict(
      "classification",
      csv("f", input.trainX, cols),
      "y\n" + Array.from(input.trainY, (c) => String(c)).join("\n") + "\n",
      csv("f", input.testX, cols),
      [{ output_type: "probas" }],
    );
    const rows = prediction as number[][];
    if (!Array.isArray(rows) || rows.length !== nTest || rows.some((r) => !Array.isArray(r) || r.length !== present.length)) {
      throw new Error("the Prior Labs API returned probabilities in an unexpected shape");
    }
    const probabilities = new Float32Array(nTest * k);
    rows.forEach((row, r) => present.forEach((cls, c) => (probabilities[r * k + cls] = row[c]!)));
    if (probabilities.some((p) => !Number.isFinite(p))) throw new Error("the Prior Labs API returned invalid numbers");
    return { probabilities, latencyMs: Date.now() - started };
  }

  async predictMean(input: TabPfnRegressionInput): Promise<TabPfnRegressionOutput> {
    const started = Date.now();
    const { cols, interval } = input;
    const nTest = input.testX.length / cols;
    const tail = interval === undefined ? 0 : Math.round(((1 - interval) / 2) * 1e6) / 1e6;
    const [mean, quantiles] = await this.predict(
      "regression",
      csv("f", input.trainX, cols),
      "y\n" + Array.from(input.trainY, (v) => String(v)).join("\n") + "\n",
      csv("f", input.testX, cols),
      [{ output_type: "mean" }, ...(interval === undefined ? [] : [{ output_type: "quantiles", quantiles: [tail, Math.round((1 - tail) * 1e6) / 1e6] }])],
    );
    const means = mean as number[];
    if (!Array.isArray(means) || means.length !== nTest || means.some((v) => !Number.isFinite(v))) {
      throw new Error("the Prior Labs API returned predictions in an unexpected shape");
    }
    const out: TabPfnRegressionOutput = { means: Float64Array.from(means), latencyMs: 0 };
    if (quantiles !== undefined) {
      // One array per requested quantile (the Python client's shape); a per-row pair is accepted too.
      const q = quantiles as number[][];
      const perQuantile = Array.isArray(q) && q.length === 2 && q.every((a) => Array.isArray(a) && a.length === nTest);
      const perRow = Array.isArray(q) && q.length === nTest && q.every((a) => Array.isArray(a) && a.length === 2);
      if (!perQuantile && !perRow) throw new Error("the Prior Labs API returned an interval in an unexpected shape");
      const at = (row: number, which: 0 | 1) => (perQuantile ? q[which]![row]! : q[row]![which]!);
      out.lower = new Float64Array(nTest);
      out.upper = new Float64Array(nTest);
      for (let r = 0; r < nTest; r++) {
        out.lower[r] = Math.min(at(r, 0), at(r, 1));
        out.upper[r] = Math.max(at(r, 0), at(r, 1));
      }
    }
    out.latencyMs = Date.now() - started;
    return out;
  }
}
