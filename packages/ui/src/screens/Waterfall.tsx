import { useEffect, useState } from "react";
import type { RowExplanation } from "@tavolio/models";
import type { Analysis } from "../analysis.js";
import { CursorTip, num, pct, plural, useCursorTip } from "../components.js";

const SHOWN = 6;

/** A push on the probability, as signed percentage points: "+12", "−4.5", "0". */
export function points(phi: number): string {
  const p = Math.abs(phi) * 100;
  if (p < 0.05) return "0";
  const body = p < 10 ? p.toFixed(1) : String(Math.round(p));
  return `${phi < 0 ? "−" : "+"}${body}`;
}

/** A push in the target's own units, signed: "+4.2K", "−12", "0". */
export function signed(phi: number): string {
  if (phi === 0 || !Number.isFinite(phi)) return "0";
  const body = num(Math.abs(phi));
  return body === "0" ? "0" : `${phi < 0 ? "−" : "+"}${body}`;
}

/** How a number reads in the chart: probability (percent, pushes in points) or the target's own units. */
interface Units {
  regression: boolean;
  target: string;
  value: (v: number) => string;
  push: (phi: number) => string;
}

const unitsFor = (regression: boolean, target: string): Units =>
  regression ? { regression, target, value: num, push: signed } : { regression, target, value: pct, push: points };

export interface Step {
  label: string;
  /** The cell's value, when this step is one column. */
  value?: string;
  phi: number;
  from: number;
  to: number;
  /** For the folded step: the columns it stands for, each placed after the one before it so they add up to this step. */
  members?: Step[];
}

/** Biggest pushes first, the rest folded into one step so the chart stays short. `from`/`to` are the running prediction. */
export function waterfallSteps(e: RowExplanation, cellText: (name: string) => string, shown = SHOWN): Step[] {
  const top = e.contributions.slice(0, shown);
  const rest = e.contributions.slice(shown);
  const steps: Step[] = [];
  let at = e.base;
  for (const c of top) {
    steps.push({ label: c.name, value: cellText(c.name), phi: c.phi, from: at, to: (at += c.phi) });
  }
  if (rest.length > 0) {
    const phi = rest.reduce((a, c) => a + c.phi, 0);
    let inner = at;
    const members = rest.map((c) => ({ label: c.name, value: cellText(c.name), phi: c.phi, from: inner, to: (inner += c.phi) }));
    steps.push({ label: plural(rest.length, "column"), phi, from: at, to: (at += phi), members });
  }
  return steps;
}

function cellText(analysis: Analysis, row: number, name: string): string {
  const idx = analysis.table.columns.findIndex((c) => c.name === name);
  const v = idx === -1 ? null : analysis.table.rows[row]?.[idx];
  if (v === null || v === undefined || v === "") return "blank";
  return typeof v === "number" ? num(v) : String(v);
}

/** `shown` stays on screen (blurred) while the next row is worked out, so the card never collapses and re-grows. */
interface State {
  row: number;
  status: "loading" | "ready" | "error";
  shown?: RowExplanation;
  message?: string;
}

export interface WaterfallProps {
  analysis: Analysis;
  /** Rows that were predicted (blank targets, else every row); 0-based. */
  rows: number[];
  explainRow: (row: number) => Promise<RowExplanation>;
  /** Regression pushes are in the target's units, classification pushes are probability points. */
  regression: boolean;
  /** The column being predicted. */
  target: string;
  /** A row the user clicked in the sheet; `n` changes on every click so the same row can be asked for again. */
  focus: { row: number; n: number } | null;
}

/** "Why this prediction": a waterfall from a typical row's prediction to this row's, one step per column. Follows the row clicked in the sheet. */
export function Waterfall({ analysis, rows, explainRow, regression, target, focus }: WaterfallProps) {
  const [state, setState] = useState<State>({ row: rows[0]!, status: "loading" });
  const [ignored, setIgnored] = useState<number | null>(null);
  /** The folded columns are opened for every row, not just this one, so stepping through rows keeps the same view. */
  const [expanded, setExpanded] = useState(false);
  const sheetRow = (r: number) => analysis.ref.row + 1 + r;

  useEffect(() => {
    if (!focus) return;
    if (rows.includes(focus.row)) {
      setIgnored(null);
      // The same row again keeps what is shown; a different one blurs it until its explanation arrives.
      setState((s) => (s.row === focus.row ? s : { ...s, row: focus.row, status: "loading" }));
    } else setIgnored(focus.row);
    // `rows` is stable for a result; the click counter is what should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const row = state.row;
  useEffect(() => {
    let current = true;
    explainRow(row).then(
      (explanation) => current && setState({ row, status: "ready", shown: explanation }),
      (e: unknown) => current && setState((s) => ({ row, status: "error", shown: s.shown, message: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      current = false;
    };
  }, [row, explainRow]);

  const busy = state.status === "loading";
  return (
    <div className="tv-card tv-why" aria-busy={busy}>
      {ignored !== null && <p className="tv-small" style={{ margin: "0 0 8px" }}>Row {sheetRow(ignored)} wasn't predicted.</p>}
      {state.status === "error" && <p className="tv-small tv-error">{state.message}</p>}
      <div className="tv-why-body" data-busy={busy ? "true" : "false"}>
        {busy && <Dots />}
        {state.shown ? (
          <Chart key={state.shown.row} analysis={analysis} e={state.shown} units={unitsFor(regression, target)} sheetRow={sheetRow(state.shown.row)} expanded={expanded} onExpanded={setExpanded} />
        ) : (
          <WaterfallSkeleton />
        )}
      </div>
      <span className="tv-sr" role="status">
        {busy ? "Working out why…" : ""}
      </span>
    </div>
  );
}

/** Three dots that hop in turn, centred over the blurred chart while a row is being worked out. */
function Dots() {
  return (
    <span className="tv-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Stand-in bars for the first load, so the blur has something to act on. */
function WaterfallSkeleton() {
  return (
    <div className="tv-wf" aria-hidden="true">
      {[78, 52, 64, 30, 44, 20].map((w, i) => (
        <div key={i} className="tv-wf-row">
          <span className="tv-wf-label">Column</span>
          <span className="tv-wf-track">
            <span className="tv-wf-bar" style={{ left: `${(100 - w) / 2}%`, width: `${w / 2}%` }} />
          </span>
          <span className="tv-wf-num">+0</span>
        </div>
      ))}
    </div>
  );
}

function Chart({ analysis, e, units, sheetRow, expanded, onExpanded }: { analysis: Analysis; e: RowExplanation; units: Units; sheetRow: number; expanded: boolean; onExpanded: (open: boolean) => void }) {
  const steps = waterfallSteps(e, (name) => cellText(analysis, e.row, name));
  // Every point a bar can reach, including the folded columns (which only show once opened) and running totals that overshoot
  // 0–100% on the way (the pushes are added in order of size, so a big one can carry the total past the end before a later one pulls it back).
  const path = [e.base, e.final, ...steps.flatMap((s) => [s.from, s.to, ...(s.members ?? []).flatMap((m) => [m.from, m.to])])];
  const lo = Math.min(...path);
  const hi = Math.max(...path);
  const pad = (hi - lo) * 0.08 || (units.regression ? Math.abs(hi) * 0.05 || 1 : 0.05);
  const min = lo - pad;
  const span = hi + pad - min || 1;
  const x = (p: number) => `${(((p - min) / span) * 100).toFixed(2)}%`;
  const [at, setAt] = useState<string | null>(null);
  const label = `Row ${sheetRow}: from ${units.value(e.base)} for a typical row to ${units.value(e.final)} for this one. ${steps.map((s) => `${s.label} ${units.push(s.phi)}`).join(", ")}.`;
  return (
    <>
      <p className="tv-why-line">
        {units.regression ? (
          <>
            Row {sheetRow}: predicted {units.target} <b>{units.value(e.final)}</b>
          </>
        ) : (
          <>
            Row {sheetRow}: predicted <b>{e.outcome}</b> <span className="tv-small">({pct(e.final)} sure)</span>
          </>
        )}
      </p>
      <div className="tv-wf" role="img" aria-label={label} data-hover={at === null ? "false" : "true"}>
        <div className="tv-wf-row" data-kind="end">
          <span className="tv-wf-label">Typical row</span>
          <span className="tv-wf-track">
            <span className="tv-wf-dot" style={{ left: x(e.base) }} />
          </span>
          <span className="tv-wf-num">{units.value(e.base)}</span>
        </div>
        {steps.map((s) => {
          const row = (step: Step, onOpen?: () => void) => (
            <StepRow key={step.label} step={step} units={units} outcome={e.outcome} x={x} span={span} active={at === null ? null : at === step.label} onActive={(on) => setAt(on ? step.label : null)} onOpen={onOpen} />
          );
          // The folded step is replaced by its columns, set off by a bracket that folds them back.
          return s.members && expanded ? (
            <div key="group" className="tv-wf-group">
              <button className="tv-wf-bracket" aria-label={`Hide ${s.label}`} title={`Hide ${s.label}`} onClick={() => { setAt(null); onExpanded(false); }} />
              {s.members.map((m) => row(m))}
            </div>
          ) : (
            row(s, s.members ? () => onExpanded(true) : undefined)
          );
        })}
        <div className="tv-wf-row" data-kind="end">
          <span className="tv-wf-label">
            <b>This row</b>
          </span>
          <span className="tv-wf-track">
            <span className="tv-wf-dot" data-strong="true" style={{ left: x(e.final) }} />
          </span>
          <span className="tv-wf-num">
            <b>{units.value(e.final)}</b>
          </span>
        </div>
      </div>
    </>
  );
}

/** One column's bar. Hovering it shows the cell's value beside the cursor and fades the other bars; the folded step opens (`onOpen`) into its columns. */
function StepRow({ step: s, units, outcome, x, span, active, onActive, onOpen }: { step: Step; units: Units; outcome: string; x: (p: number) => string; span: number; active: boolean | null; onActive: (on: boolean) => void; onOpen?: () => void }) {
  const t = useCursorTip();
  const tip = s.value === undefined ? null : t.on(s.value);
  const left = Math.min(s.from, s.to);
  const width = Math.abs(s.to - s.from);
  const dir = s.phi < 0 ? "down" : "up";
  return (
    <div
      className="tv-wf-row"
      data-active={active === null ? undefined : String(active)}
      tabIndex={0}
      onMouseEnter={(ev) => (onActive(true), tip?.onMouseEnter(ev))}
      onMouseMove={tip?.onMouseMove}
      onMouseLeave={() => (onActive(false), t.hide())}
      onFocus={(ev) => (onActive(true), tip?.onFocus(ev))}
      onBlur={() => (onActive(false), t.hide())}
    >
      {onOpen ? (
        <button className="tv-wf-label tv-wf-fold" aria-expanded="false" onClick={onOpen} title="Show these columns">
          {s.label}
        </button>
      ) : (
        <span className="tv-wf-label" title={s.label}>{s.label}</span>
      )}
      <span className="tv-wf-track">
        <span className="tv-wf-bar" data-dir={dir} style={{ left: `min(${x(left)}, calc(100% - 3px))`, width: `max(3px, ${(width / span) * 100}%)` }} />
      </span>
      <span className="tv-wf-num" data-dir={dir} title={`${units.push(s.phi)}${units.regression ? ` on ${units.target}` : ` points on ${outcome}`}`}>
        {units.push(s.phi)}
      </span>
      {tip && <CursorTip tip={t.tip} />}
    </div>
  );
}
