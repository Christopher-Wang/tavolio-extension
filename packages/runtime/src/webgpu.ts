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
