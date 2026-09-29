export type RuntimeKind = "cpu" | "wasm" | "webgpu" | "remote";
export type TensorData = Float32Array | Int32Array | BigInt64Array | Uint8Array;

export interface NamedTensor {
  name: string;
  dims: number[];
  data: TensorData;
}

export interface RunRequest {
  model: string;
  inputs: Record<string, NamedTensor>;
  options?: {
    prefer?: RuntimeKind[];
    cacheKey?: string;
  };
}

export interface RunResult {
  outputs: Record<string, NamedTensor>;
  runtime: RuntimeKind;
  latencyMs: number;
}

export interface Runtime {
  kind: RuntimeKind;
  run(request: RunRequest): Promise<RunResult>;
}
