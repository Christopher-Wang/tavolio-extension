import { useState } from "react";
import type { FeatureSignal, PredictionResult } from "@tavolio/models";
import type { Analysis } from "../analysis.js";
import { Bar, Callout, Details, Icon, compact, num, pct, plural } from "../components.js";
import { points, Waterfall } from "./Waterfall.js";

export interface ResultsProps {
  analysis: Analysis;
  result: PredictionResult;
  features: number;
  /** A row clicked in the sheet; the "Why" card follows it. */
  focusRow?: { row: number; n: number } | null;
  /** The model that made the predictions; labels its bar in the quality comparison. */
  modelName: string;
}

const METRIC_LABELS: Record<string, string> = {
  accuracy: "Accuracy",
  baselineAccuracy: "Baseline accuracy",
  mae: "Mean absolute error",
  rmse: "RMSE",
  r2: "R²",
  baselineMae: "Baseline MAE",
};

/** §6–§9: answer "is this useful?" Adding predictions to the sheet lives on the finished Running screen. */
export function Results({ analysis, result, features, focusRow = null, modelName }: ResultsProps) {
  const target = result.target;
  const isClass = result.task.type === "classification";
  const blank = result.newRowIndexes ?? [];
  const ev = result.evaluation;
  const predictedRows = blank.length > 0 ? blank : result.predictions.map((_, i) => i);

  return (
    <div className="tv-screen">
      <h1>{target} prediction</h1>
      <p className="tv-sub">{isClass ? "Classification" : "Regression"} · {plural(result.predictions.length, "row")}</p>
      {result.notice && <Callout tone="warn">{result.notice}</Callout>}

      {result.validation !== "none" && (
        <div style={{ marginTop: 14 }}>
          {ev && isClass && ev.accuracy !== undefined ? (
            <ClassQuality model={modelName} accuracy={ev.accuracy} baseline={ev.baselineAccuracy} dumb={ev.baselineKind === "majority"} />
          ) : ev && !isClass && ev.mae !== undefined ? (
            <RegressionQuality model={modelName} mae={ev.mae} baseline={ev.baselineMae} dumb={ev.baselineKind === "mean"} />
          ) : result.validation === "selection" ? (
            <p className="tv-small">
              Couldn't measure accuracy: the selected rows need a known {target}, and some other rows must be left to learn from.
            </p>
          ) : (
            <p className="tv-small">There aren't enough rows with a known {target} to measure accuracy yet.</p>
          )}
        </div>
      )}

      {result.featureSignals && result.featureSignals.length > 0 && (
        <>
          <h2>{result.explanation ? "What drives the predictions" : "Most useful signals"}</h2>
          <Signals signals={result.featureSignals} explained={result.explanation !== undefined} regression={!isClass} />
        </>
      )}

      {result.explainRow && <Waterfall analysis={analysis} rows={predictedRows} explainRow={result.explainRow} regression={!isClass} target={target} focus={focusRow} />}

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

const SIGNALS_SHOWN = 5;

function Signals({ signals, explained, regression }: { signals: FeatureSignal[]; explained: boolean; regression: boolean }) {
  const [all, setAll] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  // Classification pushes are probability points; regression pushes are in the target's units.
  const size = (v: number) => (regression ? num(v) : points(v).replace(/^\+/, ""));
  return (
    <div className="tv-bars tv-signals" data-impact={explained ? "true" : "false"}>
      {(all ? signals : signals.slice(0, SIGNALS_SHOWN)).map((s) => (
        <Bar
          key={s.name}
          label={s.name}
          value={s.strength}
          strong
          active={at === null ? null : at === s.name}
          onActive={(on) => setAt(on ? s.name : null)}
          display={s.impact === undefined ? undefined : regression ? `±${num(s.impact)}` : `±${points(s.impact).replace(/^\+/, "")}`}
          tip={s.spread && (
            <>
              <b>{s.name}</b>
              <br />
              Min {size(s.spread.min)}
              <br />
              Max {size(s.spread.max)}
              <br />
              Std {size(s.spread.std)}
            </>
          )}
        />
      ))}
      {signals.length > SIGNALS_SHOWN && (
        <button className="tv-link tv-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function ClassQuality({ model, accuracy, baseline, dumb }: { model: string; accuracy: number; baseline?: number; dumb: boolean }) {
  const [at, setAt] = useState<string | null>(null);
  const hover = (key: string) => ({ active: at === null ? null : at === key, onActive: (on: boolean) => setAt(on ? key : null) });
  return (
    <>
      <p className="tv-quality">
        Right <b>{pct(accuracy)}</b> of the time on rows it hadn't seen
      </p>
      <div className="tv-bars">
        {baseline !== undefined && <Bar label={dumb ? "Always the top" : "Baseline"} value={baseline} display={pct(baseline)} {...hover("baseline")} />}
        <Bar label={model} value={accuracy} display={pct(accuracy)} strong {...hover("model")} />
      </div>
      {baseline !== undefined && dumb && (
        <p className="tv-small" style={{ marginTop: 8, marginBottom: 0 }}>"Always the top" guesses the most common value every time.</p>
      )}
    </>
  );
}

function RegressionQuality({ model, mae, baseline, dumb }: { model: string; mae: number; baseline?: number; dumb: boolean }) {
  const max = Math.max(mae, baseline ?? 0, 1e-9);
  const [at, setAt] = useState<string | null>(null);
  const hover = (key: string) => ({ active: at === null ? null : at === key, onActive: (on: boolean) => setAt(on ? key : null) });
  return (
    <>
      <p className="tv-quality">
        Typically off by <b>± {compact(mae)}</b>
      </p>
      <div className="tv-bars">
        {baseline !== undefined && <Bar label={dumb ? "Always average" : "Baseline"} value={baseline / max} display={`± ${compact(baseline)}`} {...hover("baseline")} />}
        <Bar label={model} value={mae / max} display={`± ${compact(mae)}`} strong {...hover("model")} />
      </div>
      <p className="tv-small" style={{ marginTop: 8, marginBottom: 0 }}>
        Shorter is better.{baseline !== undefined && dumb ? ' "Always average" guesses the average every time.' : ""}
      </p>
    </>
  );
}
