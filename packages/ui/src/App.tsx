import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isPredictError } from "@tavolio/prediction";
import { LOCAL_TABULAR_MANIFEST, modelRegistry, type ApiKeyStore, type LoadProgress, type PredictionResult } from "@tavolio/models";
import { getGpuInfo, type GpuInfo } from "@tavolio/runtime";
import {
  analyze,
  buildWritePlan,
  explanationColumns,
  addressBounds,
  defaultTarget,
  previewTarget,
  runPrediction,
  type Analysis,
  type Destination,
  type PredictStage,
} from "./analysis.js";
import { HostError, NO_TABLE_MESSAGE, type HostBridge, type HostTheme } from "./host.js";
import { css } from "./styles.js";
import { Icon, Logo } from "./components.js";
import type { ColumnType } from "@tavolio/table";
import { Data, type TypeChoice } from "./screens/Data.js";
import { Counts, Predict } from "./screens/Predict.js";
import { DEFAULT_INTERVAL_PERCENT, DEFAULT_PREDICT, DEFAULT_VALIDATION, formatRowSpec, intervalLevel, predictRows, validationStrategy, type PredictChoice, type ValidationChoice } from "./validation.js";
import { Running } from "./screens/Running.js";
import { Results } from "./screens/Results.js";
import { AddToSheet } from "./screens/AddToSheet.js";

/** "run" is always listed but only enabled once a run has started (like Results); it never replaces Predict. */
type Tab = "predict" | "data" | "results" | "run";
type Run =
  | { name: "idle" }
  /** `loading` is set once the model reports a download/prepare phase, which adds a step to the list. */
  | { name: "running"; stage: PredictStage; loading?: LoadProgress }
  /** Finished: the Running screen stays up until the user chooses what's next (add to the sheet, view results). */
  | { name: "done"; loading?: LoadProgress }
  | { name: "error"; title: string; detail: string; counts?: Array<{ value: string; count: number }> };
type Boot = { name: "loading" } | { name: "empty"; message: string } | { name: "ready" };

export interface TavolioAppProps {
  host: HostBridge;
  /**
   * Sheets has no dark mode, so it pins "light"; the browser playground follows the OS with "auto".
   * A theme reported by the host itself (Excel) takes precedence.
   */
  theme?: "light" | "dark" | "auto";
  /** Show the tavolio logo + name. Hosts that already title the pane (the Sheets sidebar) turn it off. */
  brand?: boolean;
  /** Which registered model to predict with. Default: the built-in baseline. */
  modelId?: string;
  /**
   * A second, hosted model the user can pick on the Predict tab (their data is sent to it), and where their API key for it lives.
   * Absent: only the on-device model is offered.
   */
  remote?: { modelId: string; keys: ApiKeyStore };
}

/** Where predictions run: on this device, or on the hosted API. */
export type Engine = "local" | "api";

const MIN_RUNNING_MS = 700;

/** Let the browser paint a stage change before the (synchronous) model work continues. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    const t = setTimeout(done, 50);
    requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(t), done())));
  });
}

export function TavolioApp({ host, theme: fallbackTheme = "light", brand = true, modelId: localModelId = LOCAL_TABULAR_MANIFEST.id, remote }: TavolioAppProps) {
  const [engine, setEngine] = useState<Engine>("local");
  const api = engine === "api" && !!remote;
  const modelId = api ? remote!.modelId : localModelId;
  /** Whether the user has saved an API key; null until the host has said. */
  const [keySet, setKeySet] = useState<boolean | null>(null);
  useEffect(() => {
    if (!remote) return;
    void remote.keys.has().then(setKeySet, () => setKeySet(false));
  }, [remote]);
  // The baseline is registered lazily by predictTable, so it isn't in the registry yet on first render.
  const manifest = useMemo(() => (modelId === LOCAL_TABULAR_MANIFEST.id ? LOCAL_TABULAR_MANIFEST : modelRegistry.get(modelId).manifest), [modelId]);
  const [hostTheme, setHostTheme] = useState<HostTheme | null>(() => host.theme?.() ?? null);
  useEffect(() => host.watchTheme?.(setHostTheme), [host]);
  const theme = hostTheme ?? fallbackTheme;
  const [boot, setBoot] = useState<Boot>({ name: "empty", message: NO_TABLE_MESSAGE });
  const [tab, setTab] = useState<Tab>("predict");
  const [run, setRun] = useState<Run>({ name: "idle" });
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, ColumnType>>({});
  /** Columns the user marked "Identifier" (as opposed to "Ignore"): both are excluded, but an identifier gets no visualizations. */
  const [identifiers, setIdentifiers] = useState<Set<string>>(new Set());
  const [openCol, setOpenCol] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [flashKey, setFlashKey] = useState(0);
  const [destination, setDestination] = useState<Destination>("new-columns");
  const [written, setWritten] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [validation, setValidation] = useState<ValidationChoice>(DEFAULT_VALIDATION);
  const [predictChoice, setPredictChoice] = useState<PredictChoice>(DEFAULT_PREDICT);
  const [explain, setExplain] = useState(true);
  const [baseline, setBaseline] = useState(true);
  const [writeExplanations, setWriteExplanations] = useState(false);
  const [includeProbabilities, setIncludeProbabilities] = useState(true);
  const [includeInterval, setIncludeInterval] = useState(true);
  const [intervalPercent, setIntervalPercent] = useState(DEFAULT_INTERVAL_PERCENT);
  /** 0-based data row the user clicked in the sheet while on Results; the explanation card follows it. */
  const [focusRow, setFocusRow] = useState<{ row: number; n: number } | null>(null);
  /** Where Tavolio's own columns went (new columns or a new sheet), so clicking a prediction there explains that row too. */
  const outputsRef = useRef<Array<{ sheetName: string; left: number; right: number; headerRow: number }>>([]);
  const validationRef = useRef(validation);
  validationRef.current = validation;
  const predictRef = useRef(predictChoice);
  predictRef.current = predictChoice;
  const [gpu, setGpu] = useState<GpuInfo | null>(null);

  const load = useCallback(async () => {
    setBoot({ name: "loading" });
    try {
      const t0 = performance.now();
      const sheet = await host.readTable();
      const t1 = performance.now();
      const a = analyze(sheet);
      console.info(
        `[tavolio] startup: ${Math.round(t0)} ms page load -> read ${Math.round(t1 - t0)} ms, analyze ${Math.round(performance.now() - t1)} ms (${sheet.rows} rows x ${sheet.columns} cols)`,
      );
      setAnalysis(a);
      setExcluded(new Set());
      setOverrides({});
      setIdentifiers(new Set());
      setOpenCol(null);
      setTarget(defaultTarget(a));
      setValidation(DEFAULT_VALIDATION);
      setPredictChoice(DEFAULT_PREDICT);
      setResult(null);
      setFocusRow(null);
      outputsRef.current = [];
      setRun({ name: "idle" });
      setTab("predict");
      setBoot({ name: "ready" });
    } catch (e) {
      setBoot({ name: "empty", message: e instanceof HostError ? e.message : NO_TABLE_MESSAGE });
    }
  }, [host]);

  // The table is only read when the user clicks "Use current selection": never on open, and never while they're still selecting.
  useEffect(() => {
    void getGpuInfo().then(setGpu);
  }, []);

  const bootName = boot.name;
  const busy = run.name === "running";
  const view: Tab = tab === "run" && run.name === "idle" ? "predict" : tab;
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const runRef = useRef(run);
  runRef.current = run;
  const targetRef = useRef(target);
  targetRef.current = target;
  // Clicking in the sheet drives the pane: pick the target on Predict, focus a row on Results. Nothing here reads a
  // table: clicking outside it, or on the empty screen, does nothing until the user clicks "Use current selection".
  useEffect(() => {
    if (busy || bootName !== "ready") return;
    return host.watchActiveCell((cell) => {
      const a = analysisRef.current;
      if (!a) return;
      const out = outputsRef.current.find((o) => o.sheetName === cell.sheetName && cell.column >= o.left && cell.column <= o.right);
      if (out) {
        const row = (cell.row ?? 0) - out.headerRow - 1;
        if (view === "results" && cell.row !== undefined && row >= 0 && row < a.ref.rows) setFocusRow((f) => ({ row, n: (f?.n ?? 0) + 1 }));
        return;
      }
      const offset = cell.column - a.ref.column;
      const inside = cell.sheetName === a.ref.sheetName && offset >= 0 && offset < a.ref.columns;
      if (!inside) return;
      const rowOffset = (cell.row ?? 0) - a.ref.row - 1;
      if (view === "results" && cell.row !== undefined && rowOffset >= 0 && rowOffset < a.ref.rows) {
        setFocusRow((f) => ({ row: rowOffset, n: (f?.n ?? 0) + 1 }));
        return;
      }
      const name = [...a.offsets].find(([, o]) => o === offset)?.[0];
      if (!name) return;
      // Selecting rows to hold out also fires cell events; don't let them change the target.
      if (view === "predict" && name !== targetRef.current && validationRef.current.mode !== "selection" && predictRef.current.mode !== "selection") {
        setTarget(name);
        setFlashKey((k) => k + 1);
      }
    });
  }, [host, bootName, busy, view]);

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
    setIdentifiers((prev) => {
      const next = new Set(prev);
      if (choice === "identifier") next.add(name);
      else next.delete(name);
      return next;
    });
    setAnalysis(analyze(analysis.sheet, nextOverrides));
    setResult(null);
  }

  async function readSelection(which: "validation" | "predict") {
    if (!analysis) return;
    const rows = await host.readSelectedRows(analysis.ref).catch(() => []);
    const cells = formatRowSpec(rows, analysis.ref);
    if (which === "predict") setPredictChoice((c) => ({ ...c, cells }));
    else setValidation((v) => ({ ...v, cells }));
    setResult(null);
  }

  async function predict() {
    const strategy = analysis ? validationStrategy(validation, analysis.ref) : null;
    const rows = analysis ? predictRows(predictChoice, analysis.ref) : undefined;
    if (!analysis || !preview?.ok || !strategy || rows === null) return;
    const started = performance.now();
    setRun({ name: "running", stage: "preparing" });
    setTab("run");
    try {
      let loading: LoadProgress | undefined;
      const res = await runPrediction(
        analysis,
        target,
        excluded,
        strategy,
        async (stage, detail) => {
          if (stage === "loading-model" && detail) loading = detail;
          setRun({ name: "running", stage, loading });
          await nextPaint();
        },
        modelId,
        explain,
        rows,
        baseline,
        preview.task.type === "regression" && includeInterval ? intervalLevel(intervalPercent) : undefined,
      );
      const wait = MIN_RUNNING_MS - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setWritten(null);
      setWriteError(null);
      // Keep a choice made while the model was running, unless it can't apply (nothing blank to fill).
      setDestination((d) => (d === "fill-blanks" && (res.newRowIndexes ?? []).length === 0 ? "new-columns" : d));
      setFocusRow(null);
      outputsRef.current = [];
      setResult(res);
      // Stay on the Run tab: the user decides what happens next (add to the sheet, or look at the results first).
      setRun({ name: "done", loading });
      // Someone browsing Data or Predict while it ran stays put; the Run tab holds the outcome.
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
      const why = writeExplanations ? await explanationColumns(analysis, result) : null;
      const track = (r: { sheetName: string; address: string }) => {
        const b = addressBounds(r.address);
        if (b) outputsRef.current.push({ sheetName: r.sheetName, left: b.left, right: b.right, headerRow: b.top });
      };
      const res = await host.write(buildWritePlan(analysis, result, destination, why ?? [], includeProbabilities));
      // Filling blanks stays inside the table (already tracked); the other two add columns that need tracking.
      if (destination !== "fill-blanks") track(res);
      // Filling blanks only touches the target column, so the explanations go in their own new column beside the table.
      else if (why && res.address) track(await host.write({ mode: "new-columns", table: analysis.ref, columns: why }));
      if (!res.address) setWriteError("Nothing to fill: those cells already have values.");
      else setWritten(res.sheetName === analysis.ref.sheetName ? res.address : `${res.sheetName}!${res.address}`);
    } catch (e) {
      setWriteError(`Couldn't add predictions: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWriting(false);
    }
  }

  /** Back to the "make a selection" screen; the next click in the sheet reads the new table. */
  function reset() {
    setResult(null);
    setAnalysis(null);
    setFocusRow(null);
    outputsRef.current = [];
    setWritten(null);
    setWriteError(null);
    setRun({ name: "idle" });
    setTab("predict");
    setBoot({ name: "empty", message: NO_TABLE_MESSAGE });
  }

  function closeRun() {
    setRun({ name: "idle" });
    setTab("predict");
  }

  let body: ReactNode = null;
  let footer: ReactNode = null;
  const features = preview?.ok ? preview.features : 0;
  const runningProps = {
    target,
    rows: analysis?.table.rows.length ?? 0,
    features,
    model: manifest.displayName,
    runtime: manifest.preferredRuntime === "webgpu" ? "WebGPU" : manifest.preferredRuntime === "remote" ? "Prior Labs API" : "CPU",
    gpu,
    host: host.kind,
    scored: validation.mode !== "none" && baseline,
  };
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
  } else if (view === "data") {
    body = <Data analysis={analysis!} excluded={excluded} identifiers={identifiers} open={openCol} onOpen={openColumn} onChoose={choose} readOnly={busy} />;
  } else if (view === "results" && result) {
    body = (
      <Results analysis={analysis!} result={result} features={features} focusRow={focusRow} modelName={result.model?.displayName ?? manifest.displayName} />
    );
  } else if (view === "run" && run.name === "running") {
    body = (
      <Running {...runningProps} stage={run.stage} loading={run.loading}>
        <AddToSheet destination={destination} onDestination={setDestination} written={null} writeError={null} />
      </Running>
    );
    footer = (
      <button className="tv-btn tv-btn-primary tv-btn-block" disabled>
        Add predictions to sheet
      </button>
    );
  } else if (view === "run" && run.name === "done" && result) {
    body = (
      <Running {...runningProps} target={result.target} stage="evaluating" loading={run.loading} done>
        <AddToSheet
          result={result}
          destination={destination}
          onDestination={(d) => {
            setDestination(d);
            setWritten(null);
          }}
          written={written}
          writeError={writeError}
        />
      </Running>
    );
    const viewResults = () => setTab("results");
    footer = (
      <>
        {written ? (
          <button className="tv-btn tv-btn-primary tv-btn-block" onClick={viewResults}>
            View results
          </button>
        ) : (
          <>
            <button className="tv-btn tv-btn-primary tv-btn-block" disabled={writing} onClick={() => void addToSheet()}>
              {writing ? "Adding…" : "Add predictions to sheet"}
            </button>
            <button className="tv-btn tv-btn-block" disabled={writing} onClick={viewResults}>
              View results
            </button>
          </>
        )}
        <button className="tv-link" disabled={writing} onClick={closeRun}>
          Change settings
        </button>
      </>
    );
  } else if (view === "run" && run.name === "error") {
    body = (
      <div className="tv-screen">
        <h1>{run.title}</h1>
        <p className="tv-sub">{run.detail}</p>
        {run.counts && <Counts counts={run.counts} />}
      </div>
    );
    footer = (
      <button className="tv-btn tv-btn-block" onClick={closeRun}>
        Review columns
      </button>
    );
  } else {
    // While a prediction runs the settings stay visible but can't change underneath it.
    body = (
      <fieldset disabled={busy} style={{ display: "contents" }}>
      <Predict
        analysis={analysis!}
        target={target}
        preview={preview!}
        gpu={gpu}
        modelName={manifest.displayName}
        remote={!!remote}
        engine={engine}
        onEngine={(e) => {
          setEngine(e);
          setResult(null);
          setRun({ name: "idle" });
        }}
        keySet={keySet}
        onSaveKey={async (key) => {
          await remote!.keys.set(key);
          setKeySet(true);
        }}
        onClearKey={async () => {
          await remote!.keys.clear();
          setKeySet(false);
        }}
        flashKey={flashKey}
        onTarget={(t) => {
          setTarget(t);
          setRun({ name: "idle" });
        }}
        validation={validation}
        onValidation={(v) => {
          setValidation(v);
          setRun({ name: "idle" });
        }}
        explain={explain}
        onExplain={(v) => {
          setExplain(v);
          setRun({ name: "idle" });
        }}
        writeExplanations={writeExplanations}
        onWriteExplanations={setWriteExplanations}
        baseline={baseline}
        onBaseline={(v) => {
          setBaseline(v);
          setRun({ name: "idle" });
        }}
        includeProbabilities={includeProbabilities}
        onIncludeProbabilities={setIncludeProbabilities}
        includeInterval={includeInterval}
        onIncludeInterval={(v) => {
          setIncludeInterval(v);
          setRun({ name: "idle" });
        }}
        intervalPercent={intervalPercent}
        onIntervalPercent={(v) => {
          setIntervalPercent(v);
          setRun({ name: "idle" });
        }}
        busy={busy}
        onRefresh={() => void load()}
        predictChoice={predictChoice}
        onPredictChoice={(c) => {
          setPredictChoice(c);
          setResult(null);
          setRun({ name: "idle" });
        }}
        onReadSelection={(which) => void readSelection(which)}
      />
      </fieldset>
    );
    footer = (
      <button className="tv-btn tv-btn-primary tv-btn-block" disabled={busy || (api && !keySet) || !preview?.ok || !analysis || !validationStrategy(validation, analysis.ref) || predictRows(predictChoice, analysis.ref) === null} onClick={() => void predict()}>
        Predict {target}
      </button>
    );
  }

  const ready = boot.name === "ready";
  const ref = analysis?.sheet;
  const tabs: Array<{ id: Tab; label: string; disabled?: boolean }> = [
    { id: "predict", label: "Predict" },
    { id: "data", label: "Data" },
    { id: "run", label: run.name === "error" ? "Error" : "Run", disabled: run.name === "idle" },
    { id: "results", label: "Results", disabled: !result },
  ];
  return (
    <div className="tv" data-theme={theme}>
      <style>{css}</style>
      {brand && (
        <header className="tv-header">
          <span className="tv-brand">
            <Logo />
            tavolio
          </span>
        </header>
      )}
      {ready && (
        <nav className="tv-tabs" role="tablist" aria-label="Tavolio">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              className="tv-tab"
              aria-selected={view === t.id}
              disabled={t.disabled}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button className="tv-icon-btn tv-reset" disabled={busy} onClick={reset} aria-label="Start over with a new selection" title="Start over with a new selection">
            <Icon.refresh />
          </button>
        </nav>
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
export function TavolioLoading({ theme = "light", brand = true }: Pick<TavolioAppProps, "theme" | "brand">) {
  return (
    <div className="tv" data-theme={theme}>
      <style>{css}</style>
      {brand && (
        <header className="tv-header">
          <span className="tv-brand">
            <Logo />
            tavolio
          </span>
        </header>
      )}
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
