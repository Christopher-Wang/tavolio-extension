import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import {
  LocalTabularModel,
  TABPFN_FAST_MANIFEST,
  TABPFN_FAST_REGRESSION_URI,
  TabPfnClassifier,
  TabPfnModel,
  TabPfnRegressor,
  modelRegistry,
  type LoadProgress,
  type TabPfnPredictor,
  type TabPfnTaskKind,
} from "@tavolio/models";
import { OnyxRuntime, fetchBytesCached, getGpuInfo, type OrtLike, type Runtime } from "@tavolio/runtime";

/** Part of the cache key for everything downloaded here: bump it whenever the files in models/ are rebuilt. */
const MODEL_REV = "2026-10-02b";

/**
 * INT4 weights, fp32 activations: runs on any WebGPU adapter. The fp16-activation build (tabpfn_fast_client.onnx) measured
 * only ~4% faster on Apple GPU (2000x30 cells: 10.3 s vs 10.7 s) and took ~3 s longer to create the session, so it isn't used.
 */
const FILES: Record<TabPfnTaskKind, string> = {
  classification: "tabpfn_fast_client_f32.onnx",
  regression: "tabpfn_fast_reg_client_f32.onnx",
};
const URIS: Record<TabPfnTaskKind, string> = {
  classification: TABPFN_FAST_MANIFEST.artifact.uri,
  regression: TABPFN_FAST_REGRESSION_URI,
};

/**
 * models/ sits next to assets/ (the bundle), on whatever origin serves the bundle: `make serve` today.
 * `import.meta.url` goes through a variable and the path is concatenated: Vite rewrites `new URL(<template literal>, import.meta.url)`
 * into a file glob, which finds no models/ directory at build time and compiles to `undefined`.
 */
const bundleUrl = import.meta.url;
const modelUrl = (name: string) => new URL("../models/" + name + "?v=" + MODEL_REV, bundleUrl).href;

type Ort = typeof import("onnxruntime-web/webgpu");
let ort: Ort | undefined;
let active: OnyxRuntime | undefined;
const loaded = new Set<TabPfnTaskKind>();
/** The bytes of the session being created, handed to the runtime's loader once (starts are serialized, so there is only ever one). */
let artifact: { model: Uint8Array; data: Uint8Array } | null = null;

/** Download several files at once, reporting one combined progress. A cache hit reports nothing. */
async function download(urls: string[], report: (p: LoadProgress) => void): Promise<Uint8Array[]> {
  const parts = urls.map(() => ({ loaded: 0, total: 0 }));
  return Promise.all(
    urls.map((url, i) =>
      fetchBytesCached(url, {
        onProgress: ({ loaded, total }) => {
          parts[i] = { loaded, total: total ?? 0 };
          const knownTotal = parts.every((p) => p.total > 0);
          report({
            phase: "download",
            loaded: parts.reduce((s, p) => s + p.loaded, 0),
            total: knownTotal ? parts.reduce((s, p) => s + p.total, 0) : undefined,
          });
        },
      }),
    ),
  );
}

/** Why this device can't run TabPFN on WebGPU, or null when it can. */
async function unsupportedReason(): Promise<string | null> {
  const gpu = await getGpuInfo();
  if (gpu.status === "unsupported") return "this browser doesn't support WebGPU";
  if (gpu.status === "disabled") return "graphics acceleration is turned off in this browser";
  return null;
}

/** Fetch ORT-web (first time only), its wasm and the task's model files (one progress bar for all of it), then create the session. */
async function start(task: TabPfnTaskKind, report: (p: LoadProgress) => void): Promise<void> {
  const file = FILES[task];
  const needOrt = !ort;
  const [mod, files] = await Promise.all([
    needOrt ? import("onnxruntime-web/webgpu") : Promise.resolve(ort!),
    download([...(needOrt ? [ortWasmUrl] : []), modelUrl(file), modelUrl(file + ".data")], report),
  ]);
  if (needOrt) {
    mod.env.wasm.wasmBinary = files.shift();
    mod.env.wasm.numThreads = 1; // the sidebar isn't cross-origin isolated, so there is no SharedArrayBuffer
    ort = mod;
  }
  const [graph, weights] = files;

  report({ phase: "prepare" });
  // Only one session is resident at a time. The sidebar shares a process with Sheets, and a second model's weights on top of the
  // first one's can't grow the wasm heap ("out of memory"). The freed memory is reused by the new session; the bytes come back from cache.
  for (const other of loaded) {
    if (other === task) continue;
    await active?.release(URIS[other]);
    loaded.delete(other);
  }
  // One runtime for both tasks; each task's session is created once, from the bytes just fetched.
  artifact = { model: graph!, data: weights! };
  active ??= new OnyxRuntime({
    ort: ort as unknown as OrtLike,
    executionProviders: ["webgpu"],
    loadModel: async (uri) => {
      if (!artifact) throw new Error(`No model bytes for ${uri}`);
      const { model, data } = artifact;
      const name = uri === URIS.regression ? FILES.regression : FILES.classification;
      return { model, externalData: [{ path: name + ".data", data }] };
    },
  });
  try {
    await active.preload(URIS[task]);
  } finally {
    artifact = null; // the session owns its copy now (or the start failed and the bytes aren't wanted)
  }
  loaded.add(task);
  console.info(`[tavolio] TabPFN ${task} ready`);
}

/** One start per task, shared by the background warm-up and a run that arrives while it is still going; both see the same progress. */
const starting = new Map<TabPfnTaskKind, Promise<void>>();
/** Starts are serialized: they share `artifact`'s one-shot hand-off to the runtime, and a download shouldn't compete with another. */
let queue: Promise<unknown> = Promise.resolve();
let latest: LoadProgress | undefined;
const listeners = new Set<(p: LoadProgress) => void>();

async function ensureReady(onProgress: ((p: LoadProgress) => void) | undefined, task: TabPfnTaskKind): Promise<string | null> {
  if (loaded.has(task)) return null;
  const reason = await unsupportedReason();
  if (reason) return reason;
  if (onProgress) {
    listeners.add(onProgress);
    if (latest) onProgress(latest);
  }
  let pending = starting.get(task);
  if (!pending) {
    const go = () =>
      start(task, (p) => {
        latest = p;
        listeners.forEach((l) => l(p));
      }).finally(() => {
        starting.delete(task);
        latest = undefined;
      });
    pending = queue.then(go, go);
    queue = pending.catch(() => undefined);
    starting.set(task, pending);
  }
  try {
    await pending;
  } finally {
    if (onProgress) listeners.delete(onProgress);
  }
  return null;
}

function predictor(): TabPfnPredictor {
  const lazy: Runtime = {
    kind: "webgpu",
    run: (request) => {
      if (!active) throw new Error("TabPFN runtime isn't started");
      return active.run(request);
    },
  };
  const classifier = new TabPfnClassifier(lazy, URIS.classification);
  const regressor = new TabPfnRegressor(lazy, URIS.regression);
  return { predictProba: (input) => classifier.predictProba(input), predictMean: (input) => regressor.predictMean(input) };
}

/**
 * Free the sessions' wasm and GPU memory when the page goes away (a reload, or closing the sidebar) instead of leaving it to the
 * browser, which may keep the old page around while the new one loads. If the page is restored from the back/forward cache,
 * `loaded` is empty again, so the next run starts the model afresh.
 */
function releaseOnLeave(): void {
  window.addEventListener("pagehide", () => {
    const runtime = active;
    active = undefined;
    artifact = null;
    loaded.clear();
    void runtime?.dispose().catch(() => undefined);
  });
}

/** Makes TabPFN Fast available to predictTable under its manifest id. Downloads nothing until a run needs it. */
export function registerTabPfn(): string {
  releaseOnLeave();
  modelRegistry.register(new TabPfnModel({ predictor: predictor(), ensureReady, fallback: new LocalTabularModel() }));
  return TABPFN_FAST_MANIFEST.id;
}

/** Fetch and start the model in the background once the pane is up, so a run rarely waits for it. A failure here is retried by the run itself. */
export function warmTabPfn(): void {
  // Debug switch for memory work: localStorage.setItem("tavolio-no-warm", "1") in the sidebar's console stops the load on every refresh.
  try {
    if (localStorage.getItem("tavolio-no-warm")) return;
  } catch {
    // Storage can be blocked; warm up as usual.
  }
  const go = () => void ensureReady(undefined, "classification").catch((e) => console.warn("[tavolio] TabPFN warm-up failed", e));
  if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 500);
}
