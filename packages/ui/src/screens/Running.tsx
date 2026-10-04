import type { ReactNode } from "react";
import type { LoadProgress } from "@tavolio/models";
import type { GpuInfo } from "@tavolio/runtime";
import type { HostKind } from "../host.js";
import type { PredictStage } from "../analysis.js";
import { Details, Icon } from "../components.js";

const mb = (bytes: number) => Math.round(bytes / 1e6);

/** First run downloads the model (then it's cached); every run may need a moment to ready it on the GPU. */
function loadingLabel(p: LoadProgress): string {
  if (p.phase === "prepare") return "Getting the model ready…";
  const size = p.total ? `${mb(p.loaded ?? 0)} of ${mb(p.total)} MB` : `${mb(p.loaded ?? 0)} MB`;
  return `Downloading the model, first run only (${size})…`;
}

export interface RunningProps {
  target: string;
  stage: PredictStage;
  /** Set once the model reports a download/prepare phase; adds a step. */
  loading?: LoadProgress;
  /** What the model runs on, for the details table. */
  runtime: string;
  rows: number;
  features: number;
  model: string;
  gpu: GpuInfo | null;
  host: HostKind;
  /** Quality is being scored, which adds the "compare with a baseline" step. */
  scored: boolean;
  /** The run has finished: every step is ticked and `children` (what to do next) replaces the privacy note. */
  done?: boolean;
  children?: ReactNode;
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
export function Running({ target, stage, loading, runtime, rows, features, model, gpu, host, scored, done, children }: RunningProps) {
  const advice = gpuAdvice(gpu, host);
  const steps: Array<{ stage: PredictStage; label: string }> = [
    ...(loading ? [{ stage: "loading-model" as const, label: loadingLabel(loading) }] : []),
    { stage: "predicting", label: "Running model…" },
    { stage: "evaluating", label: "Evaluating predictions…" },
    ...(scored ? [{ stage: "baseline" as const, label: "Comparing with baseline…" }] : []),
  ];
  const current = done ? steps.length : Math.max(0, steps.findIndex((s) => s.stage === stage));
  return (
    <div className="tv-screen">
      <h1>{done ? `${target} predicted` : `Predicting ${target}`}</h1>
      <ol className="tv-steps" aria-live="polite">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.stage} className="tv-step" data-state={state}>
              <span className="tv-step-dot">{state === "done" && <Icon.check />}</span>
              {s.label}
            </li>
          );
        })}
      </ol>
      <h2>Add to sheet</h2>
      {children}
      {!done && (
        <div className="tv-privacy">
          <Icon.lock />
          <div>
            <b>Running locally</b>
            Your spreadsheet data doesn't leave your device.
          </div>
        </div>
      )}
      <Details summary="Details">
        <table className="tv-metrics">
          <tbody>
            <tr>
              <td>Model</td>
              <td>{model}</td>
            </tr>
            <tr>
              <td>Runtime</td>
              <td>{runtime}</td>
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
