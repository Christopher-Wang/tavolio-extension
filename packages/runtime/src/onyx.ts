import type { NamedTensor, RunRequest, RunResult, Runtime, RuntimeKind, TensorData } from "./runtime.js";

/**
 * The slice of the ONNX Runtime JS API we use. `onnxruntime-node` (tests, scripts) and `onnxruntime-web` (browser, Sheets) both
 * satisfy it, and neither is a dependency of this package: the host injects whichever build it runs on.
 */
export interface OrtTensorLike {
  readonly dims: readonly number[];
  readonly data: unknown;
}

export interface OrtSessionLike {
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
  release?(): Promise<void>;
}

export interface OrtLike {
  InferenceSession: {
    create(model: string | Uint8Array, options?: Record<string, unknown>): Promise<OrtSessionLike>;
  };
  Tensor: new (type: string, data: TensorData, dims: readonly number[]) => OrtTensorLike;
}

/** A model to load: a file path / bytes, plus any external weight files its graph refers to (`model.onnx.data`). */
export interface ModelSource {
  model: string | Uint8Array;
  externalData?: Array<{ path: string; data: string | Uint8Array }>;
}

export interface OnyxRuntimeOptions {
  ort: OrtLike;
  /** Resolve a manifest artifact uri to something the session can load (path, fetched bytes, cached bytes, …). */
  loadModel(uri: string): Promise<ModelSource>;
  /** Execution providers in preference order, e.g. ["webgpu", "wasm"] in the browser or ["cpu"] in Node. Default ["cpu"]. */
  executionProviders?: string[];
}

function ortType(data: TensorData): string {
  if (data instanceof Float32Array) return "float32";
  if (data instanceof Int32Array) return "int32";
  if (data instanceof BigInt64Array) return "int64";
  return "uint8";
}

function toTensorData(data: unknown): TensorData {
  if (data instanceof Float32Array || data instanceof Int32Array || data instanceof BigInt64Array || data instanceof Uint8Array) {
    return data;
  }
  return Float32Array.from(data as ArrayLike<number>);
}

/** Runs ONNX models through an injected ONNX Runtime build. Sessions are created once per model and reused. */
export class OnyxRuntime implements Runtime {
  readonly kind: RuntimeKind;
  private readonly sessions = new Map<string, Promise<OrtSessionLike>>();

  constructor(private readonly options: OnyxRuntimeOptions) {
    const first = options.executionProviders?.[0] ?? "cpu";
    this.kind = first === "webgpu" ? "webgpu" : first === "wasm" ? "wasm" : "cpu";
  }

  private session(uri: string): Promise<OrtSessionLike> {
    let session = this.sessions.get(uri);
    if (!session) {
      session = this.options.loadModel(uri).then((source) => {
        const sessionOptions: Record<string, unknown> = {
          executionProviders: this.options.executionProviders ?? ["cpu"],
        };
        if (source.externalData) sessionOptions.externalData = source.externalData;
        return this.options.ort.InferenceSession.create(source.model, sessionOptions);
      });
      // A failed load must not poison later attempts (e.g. a transient network error while downloading the model).
      session.catch(() => this.sessions.delete(uri));
      this.sessions.set(uri, session);
    }
    return session;
  }

  /** Load a model's artifact and create its session now, so the first `run` doesn't pay for it (and a download can show progress). */
  async preload(uri: string): Promise<void> {
    await this.session(uri);
  }

  async run(request: RunRequest): Promise<RunResult> {
    const started = Date.now();
    const session = await this.session(request.model);
    const feeds: Record<string, OrtTensorLike> = {};
    for (const [name, t] of Object.entries(request.inputs)) {
      feeds[name] = new this.options.ort.Tensor(ortType(t.data), t.data, t.dims);
    }
    const results = await session.run(feeds);
    const outputs: Record<string, NamedTensor> = {};
    for (const [name, t] of Object.entries(results)) {
      outputs[name] = { name, dims: [...t.dims], data: toTensorData(t.data) };
    }
    return { outputs, runtime: this.kind, latencyMs: Date.now() - started };
  }

  /** Release one model's session, so its wasm/GPU memory can be reused by the next one. A later `run` or `preload` recreates it. */
  async release(uri: string): Promise<void> {
    const pending = this.sessions.get(uri);
    this.sessions.delete(uri);
    await (await pending?.catch(() => undefined))?.release?.();
  }

  /** Release native session memory (matters for WebGPU buffers and large models). */
  async dispose(): Promise<void> {
    const pending = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(pending.map(async (p) => (await p).release?.()));
  }
}
