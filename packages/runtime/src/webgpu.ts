/** WebGPU capability probe. Returns false in Apps Script / non-browser hosts. */
export async function isWebGpuAvailable(): Promise<boolean> {
  try {
    const nav = (globalThis as unknown as { navigator?: unknown }).navigator as
      | { gpu?: unknown }
      | undefined;
    return !!nav?.gpu;
  } catch {
    return false;
  }
}

/**
 * "available": adapter granted. "disabled": the API exists but no adapter —
 * in practice graphics acceleration is off or the GPU is blocklisted, which
 * the user can usually fix in browser settings. "unsupported": no WebGPU API.
 */
export interface GpuInfo {
  status: "available" | "disabled" | "unsupported";
  vendor?: string;
  architecture?: string;
  shaderF16?: boolean;
}

interface AdapterLike {
  info?: { vendor?: string; architecture?: string };
  features?: { has(name: string): boolean };
}

export async function getGpuInfo(): Promise<GpuInfo> {
  const gpu = (globalThis as unknown as { navigator?: { gpu?: { requestAdapter(o?: unknown): Promise<unknown> } } })
    .navigator?.gpu;
  if (!gpu) return { status: "unsupported" };
  try {
    const adapter = (await gpu.requestAdapter({ powerPreference: "high-performance" })) as AdapterLike | null;
    if (!adapter) return { status: "disabled" };
    return {
      status: "available",
      vendor: adapter.info?.vendor || undefined,
      architecture: adapter.info?.architecture || undefined,
      shaderF16: adapter.features?.has("shader-f16") ?? false,
    };
  } catch {
    return { status: "disabled" };
  }
}
