import { Fragment, useState } from "react";
import type { GpuInfo } from "@tavolio/runtime";
import type { Engine } from "../App.js";
import { completeness, type Analysis, type TargetPreview } from "../analysis.js";
import { Bar, Breakdown, Callout, Details, Histogram, Icon, namesTip, plural, spellingsTip, typeLabel } from "../components.js";
import { MAX_INTERVAL_PERCENT, MAX_PERCENT, MIN_INTERVAL_PERCENT, MIN_PERCENT, parseRowSpec, type PredictChoice, type ValidationChoice } from "../validation.js";

export interface PredictProps {
  analysis: Analysis;
  target: string;
  preview: TargetPreview;
  gpu: GpuInfo | null;
  modelName: string;
  /** A hosted model is available as a second choice. */
  remote: boolean;
  engine: Engine;
  onEngine: (e: Engine) => void;
  /** Whether an API key is saved; null while the host is still being asked. */
  keySet: boolean | null;
  onSaveKey: (key: string) => Promise<void>;
  onClearKey: () => Promise<void>;
  /** Bumped when the target changed from a click in the sheet, to replay the flash. */
  flashKey: number;
  onTarget: (name: string) => void;
  validation: ValidationChoice;
  onValidation: (v: ValidationChoice) => void;
  /** Reads the rows currently selected in the sheet into the validation choice. */
  onReadSelection: (which: "validation" | "predict") => void;
  predictChoice: PredictChoice;
  onPredictChoice: (c: PredictChoice) => void;
  /** Classification: write how sure Tavolio is about each prediction. */
  includeProbabilities: boolean;
  onIncludeProbabilities: (v: boolean) => void;
  /** Regression: also give a range each prediction is likely to fall in. */
  includeInterval: boolean;
  onIncludeInterval: (v: boolean) => void;
  intervalPercent: number;
  onIntervalPercent: (v: number) => void;
  /** Explain the predictions with Shapley values: what moves them, column by column. */
  explain: boolean;
  onExplain: (v: boolean) => void;
  /** Also write each prediction's top drivers into the sheet (needs Shapley values). */
  writeExplanations: boolean;
  onWriteExplanations: (v: boolean) => void;
  /** Also fit a simple model on the same rows to compare against. */
  baseline: boolean;
  onBaseline: (v: boolean) => void;
  busy: boolean;
  /** Re-reads the table around the current selection. */
  onRefresh: () => void;
}

const VALIDATION: Array<{ mode: ValidationChoice["mode"]; label: string; detail: string }> = [
  { mode: "random", label: "Random", detail: "Hold out random rows with targets" },
  { mode: "selection", label: "Selection", detail: "Hold out specific rows, like B5:B20" },
  { mode: "none", label: "None", detail: "Skip the accuracy check" },
];

const PREDICT: Array<{ mode: PredictChoice["mode"]; label: string; detail: string }> = [
  { mode: "empty", label: "Empty cells", detail: "Fill in the blank cells in the column" },
  { mode: "selection", label: "Selection", detail: "Predict specific rows, like B5:B20" },
];

function taskLine(preview: Extract<TargetPreview, { ok: true }>): { task: string; detail: string } {
  if (preview.task.type === "regression") return { task: "Regression", detail: "Predicts a number" };
  const c = preview.task.classes.length;
  return { task: "Classification", detail: `${c} classes` };
}

/** The default view: what to predict, what Tavolio will use, one button. */
export function Predict({ analysis, target, preview, gpu, modelName, remote, engine, onEngine, keySet, onSaveKey, onClearKey, flashKey, onTarget, validation, onValidation, onReadSelection, predictChoice, onPredictChoice, includeProbabilities, onIncludeProbabilities, includeInterval, onIncludeInterval, intervalPercent, onIntervalPercent, explain, onExplain, writeExplanations, onWriteExplanations, baseline, onBaseline, busy, onRefresh }: PredictProps) {
  const { table, profiles } = analysis;
  const byType = profiles.reduce<Record<string, string[]>>((acc, p) => {
    (acc[typeLabel(p.type)] ??= []).push(p.name);
    return acc;
  }, {});
  const local = gpu?.status === "available" ? "WebGPU" : "This device";
  return (
    <div className="tv-screen">
      <div className="tv-heading">
        <h1>{analysis.sheet.sheetName || "Selected data"}</h1>
        <span className="tv-chip" title={`${analysis.sheet.sheetName}!${analysis.sheet.address}`}>
          <span>{analysis.sheet.address}</span>
          <button className="tv-icon-btn" aria-label="Read the selection again" title="Read the selection again" disabled={busy} onClick={onRefresh}>
            <Icon.refresh />
          </button>
        </span>
      </div>
      <p className="tv-sub" style={{ marginBottom: 2 }}>
        {plural(table.rows.length, "row")} · {plural(profiles.length, "column")}
        <br />
        {(completeness(analysis) * 100).toFixed(1)}% complete
      </p>
      <div className="tv-types">
        <Breakdown
          label="Column types"
          moreLabel="other type"
          items={Object.entries(byType).map(([k, names]) => ({ key: k, label: k, share: names.length / profiles.length, tip: namesTip(names) }))}
        />
      </div>

      <h2>What do you want to predict?</h2>
      <div className="tv-select-wrap">
        <select
          key={flashKey}
          className={`tv-select ${flashKey > 0 ? "tv-flash" : ""}`}
          value={target}
          onChange={(e) => onTarget(e.target.value)}
          aria-label="Column to predict"
        >
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <Icon.down />
      </div>

      {preview.ok ? (
        <div className="tv-target-info" key={`${target}-${preview.task.type}`}>
          <b>{taskLine(preview).task}</b>
          <span className="tv-small">{taskLine(preview).detail}</span>
          {preview.histogram && <Histogram histogram={preview.histogram} label={target} />}
          {preview.classes.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Breakdown
                label={`Breakdown of ${target}`}
                more={preview.task.type === "classification" ? preview.task.classes.length - preview.classes.length : 0}
                items={preview.classes.map((c) => ({ key: c.value, label: c.value, share: c.count / preview.labeled, tip: spellingsTip(c.variants, preview.labeled) }))}
              />
            </div>
          )}
        </div>
      ) : (
        <Callout tone="warn">
          <b>{preview.title}</b>
          <br />
          {preview.detail}
        </Callout>
      )}

      {preview.ok && (
        <>
          <h2>Rows to predict</h2>
          <fieldset className="tv-options" aria-label="Rows to predict">
            {PREDICT.map((o) => (
              <Fragment key={o.mode}>
                <label className="tv-option">
                  <input type="radio" name="tv-predict" checked={predictChoice.mode === o.mode} onChange={() => onPredictChoice({ ...predictChoice, mode: o.mode })} />
                  <span>
                    <b>{o.label}</b>
                    <span>{o.detail}</span>
                  </span>
                </label>
                {predictChoice.mode === o.mode && o.mode === "selection" && (
                  <SelectionField
                    analysis={analysis}
                    cells={predictChoice.cells}
                    onCells={(cells) => onPredictChoice({ ...predictChoice, cells })}
                    onReadSelection={() => onReadSelection("predict")}
                    label="Rows to predict, in A1 notation"
                    done="to predict"
                    avoid={null}
                  />
                )}
              </Fragment>
            ))}
          </fieldset>
        </>
      )}

      {remote && (
        <>
          <h2>Where to run it</h2>
          <fieldset className="tv-options tv-engine" aria-label="Where to run the model">
            <label className="tv-engine-card">
              <input type="radio" name="tv-engine" checked={engine === "local"} onChange={() => onEngine("local")} />
              <Icon.lock />
              <b>Local</b>
              <span>Runs on this device. Your data never leaves it</span>
            </label>
            <label className="tv-engine-card">
              <input type="radio" name="tv-engine" checked={engine === "api"} onChange={() => onEngine("api")} />
              <Icon.lightbulb />
              <b>TabPFN API</b>
              <span>Runs on Prior Labs' servers, with your own API key</span>
            </label>
          </fieldset>
          {engine === "api" ? <ApiKey keySet={keySet} onSave={onSaveKey} onClear={onClearKey} /> : <GpuStatus gpu={gpu} />}
        </>
      )}
      {!remote && (
        <div className="tv-privacy">
          <Icon.lock />
          <div>
            <b>
              {modelName} · Runs locally
            </b>
            {local}. Your data stays on this device.
          </div>
        </div>
      )}

      {preview.ok && (
        <Details summary="Advanced options">
          <Details summary="Evaluation">
          <fieldset className="tv-options" aria-label="Validation strategy">
            {VALIDATION.map((o) => (
              <Fragment key={o.mode}>
                <label className="tv-option">
                  <input type="radio" name="tv-validation" checked={validation.mode === o.mode} onChange={() => onValidation({ ...validation, mode: o.mode })} />
                  <span>
                    <b>{o.label}</b>
                    <span>{o.detail}</span>
                  </span>
                </label>
                {validation.mode === o.mode && o.mode === "random" && (
                  <label className="tv-field">
                    <span className="tv-small">Test on</span>
                    <input
                      className="tv-input tv-input-num"
                      type="number"
                      inputMode="numeric"
                      min={MIN_PERCENT}
                      max={MAX_PERCENT}
                      value={Number.isFinite(validation.percent) ? validation.percent : ""}
                      aria-invalid={!(validation.percent >= MIN_PERCENT && validation.percent <= MAX_PERCENT)}
                      onChange={(e) => onValidation({ ...validation, percent: e.target.value === "" ? NaN : Number(e.target.value) })}
                    />
                    <span className="tv-small">% of known rows ({MIN_PERCENT}–{MAX_PERCENT})</span>
                  </label>
                )}
                {validation.mode === o.mode && o.mode === "selection" && (
                  <SelectionField
                    analysis={analysis}
                    cells={validation.cells}
                    onCells={(cells) => onValidation({ ...validation, cells })}
                    onReadSelection={() => onReadSelection("validation")}
                    label="Rows to hold out, in A1 notation"
                    done="held out for testing"
                    avoid={predictChoice.mode === "selection" ? predictChoice.cells : null}
                  />
                )}
              </Fragment>
            ))}
          </fieldset>
          </Details>
          <Details summary="Prediction">
            <div className="tv-options">
              <label className="tv-switch-row">
                <input type="checkbox" role="switch" className="tv-switch" checked={includeProbabilities} disabled={preview.task.type !== "classification"} onChange={(e) => onIncludeProbabilities(e.target.checked)} />
                <span>
                  <b>Include probabilities</b>
                  <span>Classification: how sure Tavolio is about each prediction</span>
                </span>
              </label>
              <label className="tv-switch-row">
                <input type="checkbox" role="switch" className="tv-switch" checked={includeInterval} disabled={preview.task.type !== "regression"} onChange={(e) => onIncludeInterval(e.target.checked)} />
                <span>
                  <b>Include prediction interval</b>
                  <span>Regression: the range each prediction is likely to fall in</span>
                </span>
              </label>
              {preview.task.type === "regression" && includeInterval && (
                <label className="tv-field">
                  <span className="tv-small">Interval</span>
                  <input
                    className="tv-input tv-input-num"
                    type="number"
                    inputMode="numeric"
                    min={MIN_INTERVAL_PERCENT}
                    max={MAX_INTERVAL_PERCENT}
                    value={Number.isFinite(intervalPercent) ? intervalPercent : ""}
                    aria-invalid={!(intervalPercent >= MIN_INTERVAL_PERCENT && intervalPercent <= MAX_INTERVAL_PERCENT)}
                    onChange={(e) => onIntervalPercent(e.target.value === "" ? NaN : Number(e.target.value))}
                  />
                  <span className="tv-small">% ({MIN_INTERVAL_PERCENT}–{MAX_INTERVAL_PERCENT})</span>
                </label>
              )}
            </div>
          </Details>
          <Details summary="Run baseline">
            <label className="tv-switch-row">
              <input type="checkbox" role="switch" className="tv-switch" checked={baseline} onChange={(e) => onBaseline(e.target.checked)} />
              <span>
                <b>{preview.task.type === "regression" ? "Linear regression" : "Logistic regression"}</b>
                <span>Compare on the same rows</span>
              </span>
            </label>
          </Details>
          <Details summary="Explainability">
            <div className="tv-options">
              <label className="tv-switch-row">
                <input type="checkbox" role="switch" className="tv-switch" checked={explain} onChange={(e) => onExplain(e.target.checked)} />
                <span>
                  <b>Explain predictions</b>
                  <span>{engine === "api" ? "Generates Shapley values. Makes many more API calls, which use your quota" : "Generates Shapley values"}</span>
                </span>
              </label>
              <label className="tv-switch-row">
                <input type="checkbox" role="switch" className="tv-switch" checked={writeExplanations && explain} disabled={!explain} onChange={(e) => onWriteExplanations(e.target.checked)} />
                <span>Write explanations to the sheet</span>
              </label>
            </div>
          </Details>
        </Details>
      )}
    </div>
  );
}

/** Whether the on-device model can use the GPU (it needs WebGPU; without it Tavolio falls back to the built-in baseline). */
function GpuStatus({ gpu }: { gpu: GpuInfo | null }) {
  if (!gpu) return null;
  const on = gpu.status === "available";
  const detail = on
    ? [gpu.vendor, gpu.architecture].filter(Boolean).join(" ")
    : gpu.status === "disabled"
      ? "Graphics acceleration is turned off in this browser"
      : "This browser doesn't support it";
  return <span className="tv-small tv-gpu">{[on ? "WebGPU enabled" : "WebGPU unavailable", detail].filter(Boolean).join(" · ")}</span>;
}

/** The user's own Prior Labs key: saved by the host for this user only and never shown again. */
function ApiKey({ keySet, onSave, onClear }: { keySet: boolean | null; onSave: (key: string) => Promise<void>; onClear: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  if (keySet === null) return null;
  if (keySet) {
    return (
      <div className="tv-key-note">
        <Icon.check />
        <span>API key saved</span>
        <button className="tv-link" onClick={() => void onClear()}>
          Remove
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="tv-key">
        <input
          className="tv-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Prior Labs API key"
          aria-label="Prior Labs API key"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="tv-btn" disabled={saving || text.trim() === ""} onClick={() => void save()}>
          Save
        </button>
      </div>
      <span className={`tv-small ${error ? "tv-error" : ""}`}>{error ?? "Get a key at platform.priorlabs.ai. It is stored for your Google account only."}</span>
    </>
  );
}

export function Counts({ counts }: { counts: Array<{ value: string; count: number }> }) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <div className="tv-counts">
      {counts.slice(0, 6).map((c) => (
        <Bar key={c.value} label={c.value} value={c.count / max} display={plural(c.count, "row")} />
      ))}
    </div>
  );
}

function SelectionField({
  analysis,
  cells,
  onCells,
  onReadSelection,
  label,
  done,
  avoid,
}: {
  analysis: Analysis;
  cells: string;
  onCells: (cells: string) => void;
  onReadSelection: () => void;
  label: string;
  /** Finishes "N rows …" in the note. */
  done: string;
  /** Rows (A1 text) that are being predicted; they are never used for testing, so overlap is flagged. */
  avoid: string | null;
}) {
  const spec = parseRowSpec(cells, analysis.ref);
  const predicted = avoid === null ? null : parseRowSpec(avoid, analysis.ref);
  const skipped = spec.ok && predicted?.ok ? spec.rows.filter((r) => predicted.rows.includes(r)).length : 0;
  const note = !spec.ok
    ? spec.error
    : cells.trim() === ""
      ? ""
      : spec.rows.length === 0
        ? "None of those cells are in the table's data rows."
        : `${plural(spec.rows.length - skipped, "row")} ${done}${spec.outside > 0 ? ` (${plural(spec.outside, "row")} outside the table ignored)` : ""}${skipped > 0 ? ` (${plural(skipped, "row")} skipped: they're being predicted)` : ""}.`;
  return (
    <div className="tv-selection">
      <div className="tv-selection-row">
        <input
          className="tv-input"
          type="text"
          spellCheck={false}
          placeholder="e.g. B5:B20, 30:40"
          aria-label={label}
          aria-invalid={!spec.ok}
          value={cells}
          onChange={(e) => onCells(e.target.value)}
        />
        <button className="tv-link" onClick={onReadSelection} title="Fill from the rows selected in the sheet">
          Use selection
        </button>
      </div>
      {note && <span className={`tv-small ${spec.ok ? "" : "tv-error"}`}>{note}</span>}
    </div>
  );
}
