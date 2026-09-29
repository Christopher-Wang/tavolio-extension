import type { GpuInfo } from "@tavolio/runtime";
import type { PredictStage } from "../analysis.js";
import { Details, Icon } from "../components.js";

const STEPS: Array<{ stage: PredictStage; label: string }> = [
  { stage: "preparing", label: "Preparing your data" },
  { stage: "predicting", label: "Learning patterns" },
  { stage: "evaluating", label: "Checking accuracy" },
];

export interface RunningProps {
  target: string;
  stage: PredictStage;
  rows: number;
  features: number;
  model: string;
  gpu: GpuInfo | null;
}

function gpuLabel(gpu: GpuInfo | null): string {
  if (!gpu) return "Checking…";
  if (gpu.status === "unsupported") return "Not supported in this browser";
  if (gpu.status === "disabled") return "Off";
  return [gpu.vendor, gpu.architecture].filter(Boolean).join(" ") || "Available";
}

/** §5: lightweight, reassuring, technical details one click away. */
export function Running({ target, stage, rows, features, model, gpu }: RunningProps) {
  const current = STEPS.findIndex((s) => s.stage === stage);
  return (
    <div className="tv-screen">
      <h1>Predicting {target}</h1>
      <ol className="tv-steps" aria-live="polite">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.stage} className="tv-step" data-state={state}>
              <span className="tv-step-dot">{state === "done" && <Icon.check />}</span>
              {s.label}
            </li>
          );
        })}
      </ol>
      <div className="tv-privacy">
        <Icon.lock />
        <div>
          <b>Running on your device</b>
          Your spreadsheet data isn't uploaded anywhere.
        </div>
      </div>
      <Details summary="Details">
        <table className="tv-metrics">
          <tbody>
            <tr>
              <td>Model</td>
              <td>{model}</td>
            </tr>
            <tr>
              <td>Runtime</td>
              <td>CPU</td>
            </tr>
            <tr>
              <td>Graphics</td>
              <td>{gpuLabel(gpu)}</td>
            </tr>
            <tr>
              <td>Rows</td>
              <td>{rows.toLocaleString("en-US")}</td>
            </tr>
            <tr>
              <td>Columns used</td>
              <td>{features}</td>
            </tr>
          </tbody>
        </table>
        {gpu?.status === "disabled" && (
          <p className="tv-small" style={{ marginTop: 8 }}>
            Graphics acceleration is off in your browser. In Chrome, open Settings → System and turn on "Use graphics
            acceleration when available", then restart Chrome.
          </p>
        )}
      </Details>
    </div>
  );
}
