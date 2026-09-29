import type { Analysis, TargetPreview } from "../analysis.js";
import { Back, Bar, Callout, Icon, plural } from "../components.js";

export interface TargetProps {
  analysis: Analysis;
  target: string;
  preview: TargetPreview;
  /** Bumped when the target changed from a click in the sheet, to replay the flash. */
  flashKey: number;
  onTarget: (name: string) => void;
  onBack: () => void;
}

/** §3 + §10: the one decision the user makes. Pick from the list or click the column in the sheet. */
export function Target({ analysis, target, preview, flashKey, onTarget, onBack }: TargetProps) {
  return (
    <div className="tv-screen">
      <Back onClick={onBack}>Columns</Back>
      <h1>What do you want to predict?</h1>
      <p className="tv-sub">Choose a column. Tavolio learns from the others.</p>

      <div className="tv-select-wrap">
        <select
          key={flashKey}
          className={`tv-select ${flashKey > 0 ? "tv-flash" : ""}`}
          value={target}
          onChange={(e) => onTarget(e.target.value)}
          aria-label="Column to predict"
        >
          {analysis.profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <Icon.down />
      </div>
      <div className="tv-pick-hint">
        <span className="tv-pulse" />
        Or click a column in your sheet
      </div>

      {preview.ok ? (
        <div className="tv-card">
          <div className="tv-card-title">Tavolio will predict</div>
          <div className="tv-card-big">
            {preview.task.type === "regression"
              ? "A number"
              : preview.task.classes.length === 2
                ? `${preview.task.classes[0]} or ${preview.task.classes[1]}`
                : `One of ${preview.task.classes.length} categories`}
          </div>
          {preview.classes.length > 0 && (
            <div className="tv-classes">
              {preview.classes.map((c) => (
                <span key={c.value} className="tv-pill">
                  {c.value} · {c.count.toLocaleString("en-US")}
                </span>
              ))}
            </div>
          )}
          <ul className="tv-facts">
            <li>
              Learning from <b>{plural(preview.labeled, "row")}</b>
            </li>
            <li>
              Using <b>{plural(preview.features, "other column")}</b>
            </li>
            {preview.blank > 0 && (
              <li>
                <b>{plural(preview.blank, "row")}</b> without {target} will get a prediction
              </li>
            )}
          </ul>
        </div>
      ) : (
        <>
          <Callout tone="warn">
            <b>{preview.title}</b>
            <br />
            {preview.detail}
          </Callout>
          {preview.counts && <Counts counts={preview.counts} />}
        </>
      )}
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
