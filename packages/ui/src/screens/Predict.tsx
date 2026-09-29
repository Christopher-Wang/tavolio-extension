import type { GpuInfo } from "@tavolio/runtime";
import { completeness, type Analysis, type TargetPreview } from "../analysis.js";
import { Bar, Callout, Icon, plural, typeLabel } from "../components.js";

export interface PredictProps {
  analysis: Analysis;
  target: string;
  preview: TargetPreview;
  gpu: GpuInfo | null;
  modelName: string;
  /** Bumped when the target changed from a click in the sheet, to replay the flash. */
  flashKey: number;
  onTarget: (name: string) => void;
  onViewFeatures: () => void;
}

function taskLine(preview: Extract<TargetPreview, { ok: true }>): { task: string; detail: string } {
  if (preview.task.type === "regression") return { task: "Regression", detail: "Predicts a number" };
  const c = preview.task.classes.length;
  return { task: "Classification", detail: `${c} classes` };
}

/** The default view: what to predict, what Tavolio will use, one button. */
export function Predict({ analysis, target, preview, gpu, modelName, flashKey, onTarget, onViewFeatures }: PredictProps) {
  const { table, profiles } = analysis;
  const counts = profiles.reduce<Record<string, number>>((acc, p) => {
    const k = typeLabel(p.type);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const local = gpu?.status === "available" ? "WebGPU" : "This device";
  return (
    <div className="tv-screen">
      <h1>{analysis.sheet.sheetName || "Selected data"}</h1>
      <p className="tv-sub" style={{ marginBottom: 2 }}>
        {plural(table.rows.length, "row")} · {plural(profiles.length, "column")}
        <br />
        {(completeness(analysis) * 100).toFixed(1)}% complete
      </p>
      <p className="tv-small">
        {Object.entries(counts)
          .map(([k, n]) => `${n} ${k}`)
          .join(" · ")}
      </p>

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

      <div className="tv-rowline">
        <div>
          <h2 style={{ margin: 0 }}>Features</h2>
          <div>{preview.ok ? plural(preview.features, "column") : "—"}</div>
        </div>
        <button className="tv-link" onClick={onViewFeatures}>
          View features
        </button>
      </div>

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
