import type { GpuInfo } from "@tavolio/runtime";
import { completeness, type Analysis, type TargetPreview } from "../analysis.js";
import { Bar, Callout, Icon, num, plural, typeLabel } from "../components.js";
import { MAX_PERCENT, MIN_PERCENT, parseRowSpec, type ValidationChoice } from "../validation.js";

export interface PredictProps {
  analysis: Analysis;
  target: string;
  preview: TargetPreview;
  gpu: GpuInfo | null;
  modelName: string;
  /** Bumped when the target changed from a click in the sheet, to replay the flash. */
  flashKey: number;
  onTarget: (name: string) => void;
  validation: ValidationChoice;
  onValidation: (v: ValidationChoice) => void;
  /** Reads the rows currently selected in the sheet into the validation choice. */
  onReadSelection: () => void;
}

const VALIDATION: Array<{ mode: ValidationChoice["mode"]; label: string; detail: string }> = [
  { mode: "random", label: "Random", detail: "Hold out random rows with targets" },
  { mode: "selection", label: "Selection", detail: "Hold out specific rows, like B5:B20" },
  { mode: "none", label: "None", detail: "Skip the accuracy check" },
];

function taskLine(preview: Extract<TargetPreview, { ok: true }>): { task: string; detail: string } {
  if (preview.task.type === "regression") return { task: "Regression", detail: "Predicts a number" };
  const c = preview.task.classes.length;
  return { task: "Classification", detail: `${c} classes` };
}

/** The default view: what to predict, what Tavolio will use, one button. */
export function Predict({ analysis, target, preview, gpu, modelName, flashKey, onTarget, validation, onValidation, onReadSelection }: PredictProps) {
  const { table, profiles } = analysis;
  const counts = profiles.reduce<Record<string, number>>((acc, p) => {
    const k = typeLabel(p.type);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const maxCount = Math.max(1, ...Object.values(counts));
  const local = gpu?.status === "available" ? "WebGPU" : "This device";
  return (
    <div className="tv-screen">
      <h1>{analysis.sheet.sheetName || "Selected data"}</h1>
      <p className="tv-sub" style={{ marginBottom: 2 }}>
        {plural(table.rows.length, "row")} · {plural(profiles.length, "column")}
        <br />
        {(completeness(analysis) * 100).toFixed(1)}% complete
      </p>
      <div className="tv-bars tv-types" aria-label="Column types">
        {Object.entries(counts).map(([k, n]) => (
          <Bar key={k} label={k} value={n / maxCount} display={String(n)} strong />
        ))}
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
          {preview.histogram && (
            <div className="tv-hist" role="img" aria-label={`Distribution of ${target}, ${num(preview.histogram.min)} to ${num(preview.histogram.max)}`}>
              <div className="tv-hist-bars">
                {preview.histogram.bins.map((n, i) => (
                  <span key={i} title={String(n)} style={{ height: `${Math.max(n > 0 ? 6 : 0, (n / Math.max(...preview.histogram!.bins)) * 100)}%` }} />
                ))}
              </div>
              <div className="tv-hist-axis">
                <span>{num(preview.histogram.min)}</span>
                <span>{num(preview.histogram.max)}</span>
              </div>
            </div>
          )}
          {preview.classes.length > 0 && (
            <div className="tv-bars" style={{ marginTop: 8 }}>
              {preview.classes.map((c) => (
                <Bar key={c.value} label={c.value} value={c.count / preview.labeled} display={`${Math.round((c.count / preview.labeled) * 100)}%`} />
              ))}
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
          <h2>Check accuracy by</h2>
          <fieldset className="tv-options" aria-label="Validation strategy">
            {VALIDATION.map((o) => (
              <label key={o.mode} className="tv-option">
                <input type="radio" name="tv-validation" checked={validation.mode === o.mode} onChange={() => onValidation({ ...validation, mode: o.mode })} />
                <span>
                  <b>{o.label}</b>
                  <span>{o.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {validation.mode === "random" && (
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
          {validation.mode === "selection" && <SelectionField analysis={analysis} validation={validation} onValidation={onValidation} onReadSelection={onReadSelection} />}
        </>
      )}

      <div className="tv-privacy" style={{ marginTop: 14 }}>
        <Icon.lock />
        <div>
          <b>
            {modelName} · Runs locally
          </b>
          {local}. Your data stays on this device.
        </div>
      </div>
    </div>
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
  validation,
  onValidation,
  onReadSelection,
}: Pick<PredictProps, "analysis" | "validation" | "onValidation" | "onReadSelection">) {
  const spec = parseRowSpec(validation.cells, analysis.ref);
  const note = !spec.ok
    ? spec.error
    : validation.cells.trim() === ""
      ? "Type cells like B5:B20, 30:40 or select rows in the sheet."
      : spec.rows.length === 0
        ? "None of those cells are in the table's data rows."
        : `${plural(spec.rows.length, "row")} held out for testing${spec.outside > 0 ? ` (${plural(spec.outside, "row")} outside the table ignored)` : ""}.`;
  return (
    <div className="tv-selection">
      <div className="tv-selection-row">
        <input
          className="tv-input"
          type="text"
          spellCheck={false}
          placeholder="e.g. B5:B20, 30:40"
          aria-label="Rows to hold out, in A1 notation"
          aria-invalid={!spec.ok}
          value={validation.cells}
          onChange={(e) => onValidation({ ...validation, cells: e.target.value })}
        />
        <button className="tv-link" onClick={onReadSelection} title="Fill from the rows selected in the sheet">
          Use selection
        </button>
      </div>
      <span className={`tv-small ${spec.ok ? "" : "tv-error"}`}>{note}</span>
    </div>
  );
}
