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
import { HostError, NO_TABLE_MESSAGE, type HostBridge } from "./host.js";
import { css } from "./styles.js";
import { Icon, Logo } from "./components.js";
import type { ColumnType } from "@tavolio/table";
import { Data, type TypeChoice } from "./screens/Data.js";
import { Counts, Predict } from "./screens/Predict.js";
import { Running } from "./screens/Running.js";
import { Results } from "./screens/Results.js";

type Tab = "predict" | "data" | "results";
type Run =
  | { name: "idle" }
  | { name: "running"; stage: PredictStage }
  | { name: "error"; title: string; detail: string; counts?: Array<{ value: string; count: number }> };
type Boot = { name: "loading" } | { name: "empty"; message: string } | { name: "ready" };

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
  const [boot, setBoot] = useState<Boot>({ name: "loading" });
  const [tab, setTab] = useState<Tab>("predict");
  const [run, setRun] = useState<Run>({ name: "idle" });
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, ColumnType>>({});
  const [openCol, setOpenCol] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [flashKey, setFlashKey] = useState(0);
  const [destination, setDestination] = useState<Destination>("new-columns");
  const [written, setWritten] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  /** Set when the user clicks outside the analyzed table while they have work in the pane. */
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBoot({ name: "loading" });
    setPending(null);
    try {
      const sheet = await host.readTable();
      const a = analyze(sheet);
      setAnalysis(a);
      setExcluded(new Set());
      setOverrides({});
      setOpenCol(null);
      setTarget(defaultTarget(a));
      setResult(null);
      setRun({ name: "idle" });
      setTab("predict");
      setBoot({ name: "ready" });
    } catch (e) {
      setBoot({ name: "empty", message: e instanceof HostError ? e.message : NO_TABLE_MESSAGE });
    }
  }, [host]);

  useEffect(() => {
    void load();
    void getGpuInfo().then(setGpu);
  }, [load]);

  const bootName = boot.name;
  const busy = run.name === "running";
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const targetRef = useRef(target);
  targetRef.current = target;
  const hasResult = result !== null;
  // Clicking in the sheet drives the pane: retry on the empty screen, open the
  // column on Data, pick the target on Predict. Clicking outside the table never
  // discards results; it offers to analyze the new selection instead.
  useEffect(() => {
    if (busy || bootName === "loading") return;
    return host.watchActiveCell((cell) => {
      if (bootName === "empty") return void load();
      const a = analysisRef.current;
      if (!a) return;
      const offset = cell.column - a.ref.column;
      const inside = cell.sheetName === a.ref.sheetName && offset >= 0 && offset < a.ref.columns;
      if (!inside) {
        if (hasResult) setPending(`${cell.sheetName}`);
        else void load();
        return;
      }
      setPending(null);
      const name = [...a.offsets].find(([, o]) => o === offset)?.[0];
      if (!name) return;
      if (tab === "data") setOpenCol(name);
      else if (tab === "predict" && name !== targetRef.current) {
        setTarget(name);
        setFlashKey((k) => k + 1);
      }
    });
  }, [host, bootName, busy, hasResult, tab, load]);

  const preview = useMemo(
    () => (analysis && target ? previewTarget(analysis, target, excluded) : null),
    [analysis, target, excluded],
  );

  function openColumn(name: string | null) {
    setOpenCol(name);
    if (name && analysis) void host.selectColumn(analysis.ref, analysis.offsets.get(name)!).catch(() => {});
  }

  /** Overrides re-profile the table so the type, role and feature count all update at once. */
  function choose(name: string, choice: TypeChoice) {
    if (!analysis) return;
    const skip = choice === "identifier" || choice === "ignore";
    const nextOverrides = { ...overrides };
    if (skip) delete nextOverrides[name];
    else nextOverrides[name] = choice;
    setExcluded((prev) => {
      const next = new Set(prev);
      if (skip) next.add(name);
      else next.delete(name);
      return next;
    });
    setOverrides(nextOverrides);
    setAnalysis(analyze(analysis.sheet, nextOverrides));
    setResult(null);
  }

  async function predict() {
    if (!analysis || !preview?.ok) return;
    const started = performance.now();
    setRun({ name: "running", stage: "preparing" });
    try {
      const res = await runPrediction(analysis, target, excluded, async (stage) => {
        setRun({ name: "running", stage });
        await nextPaint();
      });
      const wait = MIN_RUNNING_MS - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setWritten(null);
      setWriteError(null);
      setDestination("new-columns");
      setResult(res);
      setRun({ name: "idle" });
      setTab("results");
    } catch (e) {
      if (isPredictError(e)) setRun({ name: "error", title: e.title, detail: e.detail, counts: e.counts });
      else setRun({ name: "error", title: "This table couldn't be analyzed", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  async function addToSheet() {
    if (!analysis || !result) return;
    setWriting(true);
    setWriteError(null);
    try {
      const res = await host.write(buildWritePlan(analysis, result, destination));
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
  const features = preview?.ok ? preview.features : 0;
  if (boot.name === "loading") {
    body = <Skeleton />;
  } else if (boot.name === "empty") {
    body = (
      <div className="tv-screen tv-empty">
        <EmptyArt />
        <h1>Make predictions from your spreadsheet</h1>
        <p className="tv-sub">Select a table or range to get started.</p>
        <p className="tv-small">{boot.message}</p>
      </div>
    );
    footer = (
      <button className="tv-btn tv-btn-primary tv-btn-block" onClick={() => void load()}>
        Use current selection
      </button>
    );
  } else if (run.name === "running") {
    body = (
      <Running
        target={target}
        stage={run.stage}
        rows={analysis!.table.rows.length}
        features={features}
        model={LOCAL_TABULAR_MANIFEST.displayName}
        gpu={gpu}
        host={host.kind}
      />
    );
  } else if (tab === "data") {
    body = <Data analysis={analysis!} excluded={excluded} open={openCol} onOpen={openColumn} onChoose={choose} />;
  } else if (tab === "results" && result) {
    body = (
      <Results
        analysis={analysis!}
        result={result}
        destination={destination}
        onDestination={(d) => {
          setDestination(d);
          setWritten(null);
        }}
        written={written}
        writeError={writeError}
        features={features}
      />
    );
    footer = (
      <button
        className="tv-btn tv-btn-primary tv-btn-block"
        disabled={writing || written !== null}
        onClick={() => void addToSheet()}
      >
        {writing ? "Adding…" : written ? "Predictions added" : "Add predictions to sheet"}
      </button>
    );
  } else if (run.name === "error") {
    body = (
      <div className="tv-screen">
        <h1>{run.title}</h1>
        <p className="tv-sub">{run.detail}</p>
        {run.counts && <Counts counts={run.counts} />}
      </div>
    );
    footer = (
      <button className="tv-btn tv-btn-block" onClick={() => setRun({ name: "idle" })}>
        Review columns
      </button>
    );
  } else {
    body = (
      <Predict
        analysis={analysis!}
        target={target}
        preview={preview!}
        gpu={gpu}
        modelName={LOCAL_TABULAR_MANIFEST.displayName}
        flashKey={flashKey}
        onTarget={(t) => {
          setTarget(t);
          setRun({ name: "idle" });
        }}
        onViewFeatures={() => setTab("data")}
      />
    );
    footer = (
      <button className="tv-btn tv-btn-primary tv-btn-block" disabled={!preview?.ok} onClick={() => void predict()}>
        Predict {target}
      </button>
    );
  }

  const ready = boot.name === "ready";
  const ref = analysis?.sheet;
  const tabs: Array<{ id: Tab; label: string; disabled?: boolean }> = [
    { id: "predict", label: "Predict" },
    { id: "data", label: "Data" },
    { id: "results", label: "Results", disabled: !result },
  ];
  return (
    <div className="tv" data-theme={theme}>
      <style>{css}</style>
      <header className="tv-header">
        <span className="tv-brand">
          <Logo />
          tavolio
        </span>
        {ref && ready && (
          <span className="tv-chip" title={`${ref.sheetName}!${ref.address}`}>
            <span>
              {ref.sheetName} · {ref.address}
            </span>
            <button
              className="tv-icon-btn"
              aria-label="Read the selection again"
              title="Read the selection again"
              disabled={busy}
              onClick={() => void load()}
            >
              <Icon.refresh />
            </button>
          </span>
        )}
      </header>
      {ready && (
        <nav className="tv-tabs" role="tablist" aria-label="Tavolio">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              className="tv-tab"
              aria-selected={tab === t.id}
              disabled={t.disabled || busy}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}
      {pending && ready && (
        <div className="tv-banner" role="status">
          <div>
            <b>New data selected</b>
            <span className="tv-small">{pending}</span>
          </div>
          <div className="tv-banner-actions">
            <button className="tv-link" onClick={() => void load()}>
              Analyze new selection
            </button>
            <button className="tv-link" style={{ color: "var(--muted)" }} onClick={() => setPending(null)}>
              Keep current results
            </button>
          </div>
        </div>
      )}
      <main className="tv-main">{body}</main>
      {footer && <footer className="tv-footer">{footer}</footer>}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Reading your table">
      <div className="tv-skel" style={{ width: "55%", height: 18 }} />
      <div className="tv-skel" style={{ width: "80%" }} />
      <div className="tv-skel" style={{ height: 48, marginTop: 16 }} />
      <div className="tv-skel" style={{ height: 160 }} />
    </div>
  );
}

/** The app's first paint, shown by hosts while they work out where they're running. */
export function TavolioLoading({ theme = "light" }: Pick<TavolioAppProps, "theme">) {
  return (
    <div className="tv" data-theme={theme}>
      <style>{css}</style>
      <header className="tv-header">
        <span className="tv-brand">
          <Logo />
          tavolio
        </span>
      </header>
      <main className="tv-main">
        <Skeleton />
      </main>
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
