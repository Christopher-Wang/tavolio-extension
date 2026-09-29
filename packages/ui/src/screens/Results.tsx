import { columnTopValues } from "@tavolio/preprocessing";
import type { PredictionResult } from "@tavolio/models";
import type { Analysis, Destination } from "../analysis.js";
import { Back, Bar, Callout, Details, Icon, compact, num, pct, plural } from "../components.js";

export interface ResultsProps {
  analysis: Analysis;
  result: PredictionResult;
  destination: Destination;
  onDestination: (d: Destination) => void;
  /** Address written to, once the user has added predictions. */
  written: string | null;
  writeError: string | null;
  onBack: () => void;
}

const METRIC_LABELS: Record<string, string> = {
  accuracy: "Accuracy",
  baselineAccuracy: "Baseline accuracy",
  mae: "Mean absolute error",
  rmse: "RMSE",
  r2: "R²",
  baselineMae: "Baseline MAE",
};

/** §6–§9: answer "is this useful?" first, then make adding predictions the payoff. */
export function Results({ analysis, result, destination, onDestination, written, writeError, onBack }: ResultsProps) {
  const target = result.target;
  const isClass = result.task.type === "classification";
  const blank = result.newRowIndexes ?? [];
  const ev = result.evaluation;
  const previewRows = (blank.length > 0 ? blank : result.predictions.map((_, i) => i)).slice(0, 5);

  return (
    <div className="tv-screen">
      <Back onClick={onBack}>Change column</Back>
      <h1>{target}</h1>

      <div className="tv-card">
        <div className="tv-card-title">Prediction quality</div>
        {ev && isClass && ev.accuracy !== undefined ? (
          <ClassQuality analysis={analysis} target={target} accuracy={ev.accuracy} baseline={ev.baselineAccuracy ?? 0} />
        ) : ev && !isClass && ev.mae !== undefined ? (
          <RegressionQuality mae={ev.mae} baseline={ev.baselineMae ?? 0} />
        ) : (
          <p className="tv-small">There aren't enough rows with a known {target} to measure accuracy yet.</p>
        )}
      </div>

      {result.featureSignals && result.featureSignals.length > 0 && (
        <>
          <h2>Most useful signals</h2>
          <div className="tv-bars tv-signals">
            {result.featureSignals.slice(0, 6).map((s, i) => (
              <Bar key={s.name} label={s.name} value={s.strength} strong={i === 0} />
            ))}
          </div>
        </>
      )}

      <h2>Add to sheet</h2>
      <fieldset className="tv-options">
        <legend className="tv-small" style={{ padding: 0, marginBottom: 6 }}>
          {blank.length > 0
            ? `Predictions for the ${plural(blank.length, "row")} without ${target}.`
            : `Predictions for all ${plural(result.predictions.length, "row")}.`}
        </legend>
        <Option
          value="new-columns"
          current={destination}
          onChange={onDestination}
          title="New columns"
          detail={isClass ? "Prediction and confidence, next to your table" : "Prediction, next to your table"}
        />
        <Option
          value="new-sheet"
          current={destination}
          onChange={onDestination}
          title="New sheet"
          detail="A copy of your table with predictions added"
        />
        <Option
          value="fill-blanks"
          current={destination}
          onChange={onDestination}
          disabled={blank.length === 0}
          title="Fill blank cells"
          detail={blank.length > 0 ? `Write into the empty ${target} cells` : `Every row already has a ${target}`}
        />
      </fieldset>

      {written ? (
        <div className="tv-success" style={{ marginTop: 10 }} role="status">
          <Icon.done />
          <span>Added to {written}. Nothing else was changed.</span>
        </div>
      ) : writeError ? (
        <Callout tone="danger">{writeError}</Callout>
      ) : null}

      <Details summary="Preview">
        <table className="tv-preview">
          <tbody>
            {previewRows.map((i) => (
              <tr key={i}>
                <td className="tv-small">Row {analysis.ref.row + 1 + i}</td>
                <td>
                  <b>{typeof result.predictions[i] === "number" ? num(result.predictions[i] as number) : String(result.predictions[i])}</b>
                </td>
                <td>{isClass && result.confidences?.[i] !== undefined ? pct(result.confidences[i]!) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Details>

      {result.metrics && Object.keys(result.metrics).length > 0 && (
        <Details summary="Advanced metrics">
          <table className="tv-metrics">
            <tbody>
              {Object.entries(result.metrics).map(([k, v]) => (
                <tr key={k}>
                  <td>{METRIC_LABELS[k] ?? k}</td>
                  <td>{k.toLowerCase().includes("accuracy") ? pct(v) : num(v)}</td>
                </tr>
              ))}
              {result.model && (
                <tr>
                  <td>Model</td>
                  <td>{result.model.displayName}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Details>
      )}

      {result.warnings.length > 0 && (
        <Details summary="Notes">
          {result.warnings.map((w) => (
            <p key={w} className="tv-small">
              {w}
            </p>
          ))}
        </Details>
      )}
    </div>
  );
}

function ClassQuality({ analysis, target, accuracy, baseline }: { analysis: Analysis; target: string; accuracy: number; baseline: number }) {
  const majority = columnTopValues(analysis.table, target)[0]?.value;
  const beats = accuracy - baseline >= 0.02;
  return (
    <>
      <p className="tv-quality">
        Right <b>{pct(accuracy)}</b> of the time on rows it hadn't seen
      </p>
      <div className="tv-bars">
        <Bar label="Guessing" value={baseline} display={pct(baseline)} />
        <Bar label="Tavolio" value={accuracy} display={pct(accuracy)} strong />
      </div>
      <p className="tv-small" style={{ marginTop: 8, marginBottom: 0 }}>
        {majority ? `"Guessing" always answers "${majority}", the most common value.` : "Compared with always guessing the most common value."}
      </p>
      {!beats && (
        <Callout tone="warn">
          Tavolio isn't clearly beating a simple guess here. The other columns may not say much about {target}.
        </Callout>
      )}
    </>
  );
}

function RegressionQuality({ mae, baseline }: { mae: number; baseline: number }) {
  const max = Math.max(mae, baseline, 1e-9);
  const beats = baseline - mae >= 0.02 * baseline;
  return (
    <>
      <p className="tv-quality">
        Typically off by <b>± {compact(mae)}</b>
      </p>
      <div className="tv-bars">
        <Bar label="Guessing" value={baseline / max} display={`± ${compact(baseline)}`} />
        <Bar label="Tavolio" value={mae / max} display={`± ${compact(mae)}`} strong />
      </div>
      <p className="tv-small" style={{ marginTop: 8, marginBottom: 0 }}>
        Shorter is better. "Guessing" always answers the average.
      </p>
      {!beats && (
        <Callout tone="warn">Tavolio isn't clearly beating a simple average here. The other columns may not say much about it.</Callout>
      )}
    </>
  );
}

function Option({
  value,
  current,
  onChange,
  title,
  detail,
  disabled,
}: {
  value: Destination;
  current: Destination;
  onChange: (d: Destination) => void;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <label className="tv-option">
      <input
        type="radio"
        name="tv-destination"
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <div>
        <b>{title}</b>
        <span>{detail}</span>
      </div>
    </label>
  );
}
