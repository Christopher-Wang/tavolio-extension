import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isPredictError } from "@tavolio/prediction";
import { LOCAL_TABULAR_MANIFEST, type PredictionResult } from "@tavolio/models";
import { getGpuInfo, type GpuInfo } from "@tavolio/runtime";
import {
  analyze,
  buildWritePlan,
  defaultTarget,
  previewTarget,
  runPrediction,
  type Analysis,
  type Destination,
  type PredictStage,
} from "./analysis.js";
import { HostError, type HostBridge } from "./host.js";
import { css } from "./styles.js";
import { Icon, Logo } from "./components.js";
import { Overview } from "./screens/Overview.js";
import { Counts, Target } from "./screens/Target.js";
import { Running } from "./screens/Running.js";
import { Results } from "./screens/Results.js";

type Screen =
  | { name: "loading" }
  | { name: "empty"; message: string }
  | { name: "overview" }
  | { name: "target" }
  | { name: "running"; stage: PredictStage }
  | { name: "results"; result: PredictionResult }
  | { name: "error"; title: string; detail: string; counts?: Array<{ value: string; count: number }> };

export interface TavolioAppProps {
  host: HostBridge;
  /** Sheets has no dark mode, so it pins "light"; hosts that follow the OS use "auto". */
  theme?: "light" | "auto";
}

const MIN_RUNNING_MS = 700;

/** Let the browser paint a stage change before the (synchronous) model work continues. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    const t = setTimeout(done, 50);
    requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(t), done())));
  });
}

export function TavolioApp({ host, theme = "light" }: TavolioAppProps) {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [openCol, setOpenCol] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [flashKey, setFlashKey] = useState(0);
  const [destination, setDestination] = useState<Destination>("new-columns");
  const [written, setWritten] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);

  const load = useCallback(async () => {
    setScreen({ name: "loading" });
    try {
      const sheet = await host.readTable();
      const a = analyze(sheet);
      setAnalysis(a);
      setExcluded(new Set());
      setOpenCol(null);
      setTarget(defaultTarget(a));
      setScreen({ name: "overview" });
    } catch (e) {
      const message =
        e instanceof HostError ? e.message : "Click any cell inside your table, and Tavolio will find the rest.";
      setScreen({ name: "empty", message });
    }
  }, [host]);

  useEffect(() => {
    void load();
    void getGpuInfo().then(setGpu);
  }, [load]);

  // Clicking in the sheet drives the sidebar: on the empty screen it retries
  // detection, on the column list it opens that column, and on the target
  // screen it picks the target (§10).
  const screenName = screen.name;
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (screenName !== "empty" && screenName !== "overview" && screenName !== "target") return;
    return host.watchActiveCell((cell) => {
      if (screenName === "empty") return void load();
      const a = analysisRef.current;
      if (!a || cell.sheetName !== a.ref.sheetName) return;
      const offset = cell.column - a.ref.column;
      const name = [...a.offsets].find(([, o]) => o === offset)?.[0];
      if (!name) return;
      if (screenName === "overview") setOpenCol(name);
      else if (name !== targetRef.current) {
        setTarget(name);
        setFlashKey((k) => k + 1);
      }
    });
  }, [host, screenName, load]);

  const preview = useMemo(
    () => (analysis && target ? previewTarget(analysis, target, excluded) : null),
    [analysis, target, excluded],
  );

  function openColumn(name: string | null) {
    setOpenCol(name);
    if (name && analysis) void host.selectColumn(analysis.ref, analysis.offsets.get(name)!).catch(() => {});
  }

  function toggleExclude(name: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }

  async function predict() {
    if (!analysis || !preview?.ok) return;
    const started = performance.now();
    setScreen({ name: "running", stage: "preparing" });
    try {
      const result = await runPrediction(analysis, target, excluded, async (stage) => {
        setScreen({ name: "running", stage });
        await nextPaint();
      });
      const wait = MIN_RUNNING_MS - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setWritten(null);
      setWriteError(null);
      setDestination("new-columns");
      setScreen({ name: "results", result });
    } catch (e) {
      if (isPredictError(e)) setScreen({ name: "error", title: e.title, detail: e.detail, counts: e.counts });
      else setScreen({ name: "error", title: "Something went wrong", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  async function addToSheet() {
    if (!analysis || screen.name !== "results") return;
    setWriting(true);
    setWriteError(null);
    try {
      const res = await host.write(buildWritePlan(analysis, screen.result, destination));
      if (!res.address) setWriteError("Nothing to fill: those cells already have values.");
      else setWritten(res.sheetName === analysis.ref.sheetName ? res.address : `${res.sheetName}!${res.address}`);
    } catch (e) {
      setWriteError(`Couldn't add predictions: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWriting(false);
    }
  }

  let body: ReactNode = null;
  let footer: ReactNode = null;
  switch (screen.name) {
    case "loading":
      body = (
        <div aria-busy="true" aria-label="Reading your table">
          <div className="tv-skel" style={{ width: "55%", height: 18 }} />
          <div className="tv-skel" style={{ width: "80%" }} />
          <div className="tv-skel" style={{ height: 48, marginTop: 16 }} />
          <div className="tv-skel" style={{ height: 160 }} />
        </div>
      );
      break;
    case "empty":
      body = (
        <div className="tv-screen tv-empty">
          <EmptyArt />
          <h1>Select your table</h1>
          <p className="tv-sub">{screen.message}</p>
        </div>
      );
      footer = (
        <button className="tv-btn tv-btn-primary tv-btn-block" onClick={() => void load()}>
          Use current selection
        </button>
      );
      break;
    case "overview":
      body = (
        <Overview
          analysis={analysis!}
          excluded={excluded}
          open={openCol}
          onOpen={openColumn}
          onToggleExclude={toggleExclude}
        />
      );
      footer = (
        <button className="tv-btn tv-btn-primary tv-btn-block" onClick={() => setScreen({ name: "target" })}>
          Continue
        </button>
      );
      break;
    case "target":
      body = (
        <Target
          analysis={analysis!}
          target={target}
          preview={preview!}
          flashKey={flashKey}
          onTarget={setTarget}
          onBack={() => setScreen({ name: "overview" })}
        />
      );
      footer = (
        <button className="tv-btn tv-btn-primary tv-btn-block" disabled={!preview?.ok} onClick={() => void predict()}>
          Predict {target}
        </button>
      );
      break;
    case "running":
      body = (
        <Running
          target={target}
          stage={screen.stage}
          rows={analysis!.table.rows.length}
          features={preview?.ok ? preview.features : 0}
          model={LOCAL_TABULAR_MANIFEST.displayName}
          gpu={gpu}
        />
      );
      break;
    case "results":
      body = (
        <Results
          analysis={analysis!}
          result={screen.result}
          destination={destination}
          onDestination={(d) => {
            setDestination(d);
            setWritten(null);
          }}
          written={written}
          writeError={writeError}
          onBack={() => setScreen({ name: "target" })}
        />
      );
      footer = (
        <button
          className="tv-btn tv-btn-primary tv-btn-block"
          disabled={writing || written !== null}
          onClick={() => void addToSheet()}
        >
          {writing ? "Adding…" : written ? "Added" : "Add predictions to sheet"}
        </button>
      );
      break;
    case "error":
      body = (
        <div className="tv-screen">
          <h1>{screen.title}</h1>
          <p className="tv-sub">{screen.detail}</p>
          {screen.counts && <Counts counts={screen.counts} />}
        </div>
      );
      footer = (
        <button className="tv-btn tv-btn-block" onClick={() => setScreen({ name: "target" })}>
          Choose another column
        </button>
      );
      break;
  }

  const ref = analysis?.sheet;
  return (
    <div className="tv" data-theme={theme}>
      <style>{css}</style>
      <header className="tv-header">
        <span className="tv-brand">
          <Logo />
          Tavolio
        </span>
        {ref && screen.name !== "empty" && screen.name !== "loading" && (
          <span className="tv-chip" title={`${ref.sheetName}!${ref.address}`}>
            <span>
              {ref.sheetName} · {ref.address}
            </span>
            <button
              className="tv-icon-btn"
              aria-label="Read the selection again"
              title="Read the selection again"
              disabled={screen.name === "running"}
              onClick={() => void load()}
            >
              <Icon.refresh />
            </button>
          </span>
        )}
      </header>
      <main className="tv-main">{body}</main>
      {footer && <footer className="tv-footer">{footer}</footer>}
    </div>
  );
}

function EmptyArt() {
  return (
    <svg className="tv-empty-art" viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="10" y="8" width="100" height="64" rx="6" />
      <path d="M10 24h100M10 40h100M10 56h100M42 8v64M76 8v64" opacity="0.5" />
      <rect x="44" y="26" width="30" height="12" rx="2" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" />
      <path d="M70 34l12 12-5 1 3 6-3 1.5-3-6-4 3.5z" fill="var(--bg)" stroke="var(--text)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
