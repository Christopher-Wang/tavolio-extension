import type { GpuInfo } from "@tavolio/runtime";
import type { HostKind } from "../host.js";
import type { PredictStage } from "../analysis.js";
import { Details, Icon } from "../components.js";

const STEPS: Array<{ stage: PredictStage; label: string }> = [
  { stage: "preparing", label: "Preparing data…" },
  { stage: "predicting", label: "Running model…" },
  { stage: "evaluating", label: "Evaluating predictions…" },
];

export interface RunningProps {
  target: string;
  stage: PredictStage;
  rows: number;
  features: number;
  model: string;
  gpu: GpuInfo | null;
  host: HostKind;
}

function gpuLabel(gpu: GpuInfo | null): string {
  if (!gpu) return "Checking…";
  if (gpu.status === "unsupported") return "Not supported in this browser";
  if (gpu.status === "disabled") return "Off";
  return [gpu.vendor, gpu.architecture].filter(Boolean).join(" ") || "Available";
}

/** What the user can actually do about missing graphics acceleration, by where Tavolio runs. */
function gpuAdvice(gpu: GpuInfo | null, host: HostKind): string | null {
  if (!gpu || gpu.status === "available") return null;
  if (host === "excel") {
    return "Excel uses your system's built-in web view, so this depends on your Excel and operating system versions. Updating both usually helps.";
  }
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Firefox\//.test(ua)) {
    return "WebGPU support in Firefox depends on its version and your operating system. Updating Firefox is the first thing to try.";
  }
  if (gpu.status === "disabled" && /Chrome\//.test(ua)) {
    return 'Graphics acceleration is off in your browser. Open Settings → System, turn on "Use graphics acceleration when available", then restart the browser.';
  }
  return "This browser doesn't offer graphics acceleration, so Tavolio uses your CPU instead. Updating your browser may help.";
}

/** §5: lightweight, reassuring, technical details one click away. */
export function Running({ target, stage, rows, features, model, gpu, host }: RunningProps) {
  const advice = gpuAdvice(gpu, host);
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
          <b>Running locally</b>
          Your spreadsheet data doesn't leave your device.
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
        {advice && (
          <p className="tv-small" style={{ marginTop: 8 }}>
            {advice}
          </p>
        )}
      </Details>
    </div>
  );
}
