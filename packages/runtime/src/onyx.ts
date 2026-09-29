import type { RunRequest, RunResult, Runtime } from "./runtime.js";

/**
 * Placeholder ONNX runtime. The rest of the codebase programs against
 * the Runtime interface; onnxruntime-web / Onyx wiring lives here only.
 */
export class OnyxRuntime implements Runtime {
  readonly kind = "webgpu" as const;
  private sessions = new Map<string, unknown>();

  async run(request: RunRequest): Promise<RunResult> {
    const started = Date.now();
    void this.sessions;
    // TODO: load cached ONNX artifact, create InferenceSession with
    // executionProviders ['webgpu','wasm'], run feeds, return outputs.
    throw new Error(
      `OnyxRuntime not wired yet (model=${request.model}). Wire onnxruntime-web here.`,
    );
  }
}
