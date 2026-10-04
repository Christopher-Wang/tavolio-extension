import type { ValidationStrategy } from "@tavolio/models";

/** What the Predict tab edits; turned into a ValidationStrategy by validationStrategy(). */
export interface ValidationChoice {
  mode: ValidationStrategy["kind"];
  /** Rows to hold out, in A1 notation ("5:20, B30, D40:D45"). Used when mode is "selection". */
  cells: string;
  /** Share of known rows to hold out, 5-90. Used when mode is "random". */
  percent: number;
}

export const DEFAULT_VALIDATION: ValidationChoice = { mode: "random", cells: "", percent: 30 };
export const MIN_PERCENT = 5;
export const MAX_PERCENT = 90;

/** Prediction interval coverage, in percent. */
export const DEFAULT_INTERVAL_PERCENT = 95;
export const MIN_INTERVAL_PERCENT = 50;
export const MAX_INTERVAL_PERCENT = 99;
/** The share (0..1) to ask the model for; an out-of-range entry falls back to the default. */
export function intervalLevel(percent: number): number {
  return percent >= MIN_INTERVAL_PERCENT && percent <= MAX_INTERVAL_PERCENT ? percent / 100 : DEFAULT_INTERVAL_PERCENT / 100;
}

interface TableRows {
  /** 1-based sheet row of the header. */
  row: number;
  /** Data rows, header excluded. */
  rows: number;
}

/** Sheet rows named by "5:20", "B2:D10", "C7"; a single number means one row. Columns don't matter. */
const PART = /^\$?([A-Za-z]{0,3})\$?(\d+)(?::\$?([A-Za-z]{0,3})\$?(\d+))?$/;

export type RowSpec = { ok: true; rows: number[]; outside: number } | { ok: false; error: string };

/** Parses A1-style cells into 0-based data-row indexes of the table; rows outside it are counted, not kept. */
export function parseRowSpec(text: string, t: TableRows): RowSpec {
  const picked = new Set<number>();
  let outside = 0;
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  for (const part of parts) {
    const m = PART.exec(part);
    if (!m) return { ok: false, error: `"${part}" isn't a cell or range like B5:B20 or 5:20.` };
    const a = Number(m[2]);
    const b = m[4] === undefined ? a : Number(m[4]);
    for (let r = Math.min(a, b); r <= Math.max(a, b); r++) {
      const i = r - t.row - 1;
      if (i >= 0 && i < t.rows) picked.add(i);
      else outside++;
    }
  }
  return { ok: true, rows: [...picked].sort((x, y) => x - y), outside };
}

/** Compact "6:20, 25" text for a list of 0-based data-row indexes. */
export function formatRowSpec(rows: number[], t: TableRows): string {
  const out: string[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j]! + 1) j++;
    const a = rows[i]! + t.row + 1;
    const b = rows[j]! + t.row + 1;
    out.push(a === b ? String(a) : `${a}:${b}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** null when the choice can't be run yet (bad or empty selection, percent out of range). */
export function validationStrategy(v: ValidationChoice, t: TableRows): ValidationStrategy | null {
  if (v.mode === "none") return { kind: "none" };
  if (v.mode === "random") {
    if (!(v.percent >= MIN_PERCENT && v.percent <= MAX_PERCENT)) return null;
    return { kind: "random", testFraction: v.percent / 100 };
  }
  const spec = parseRowSpec(v.cells, t);
  return spec.ok && spec.rows.length > 0 ? { kind: "selection", rows: spec.rows } : null;
}

/** Which rows get predictions: the blank-target cells, or exactly the rows named in `cells`. */
export interface PredictChoice {
  mode: "empty" | "selection";
  /** Rows to predict, in A1 notation. Used when mode is "selection". */
  cells: string;
}

export const DEFAULT_PREDICT: PredictChoice = { mode: "empty", cells: "" };

/** undefined = blank targets (the default); null = can't run yet (bad or empty selection); otherwise the 0-based rows to predict. */
export function predictRows(c: PredictChoice, t: TableRows): number[] | null | undefined {
  if (c.mode === "empty") return undefined;
  const spec = parseRowSpec(c.cells, t);
  return spec.ok && spec.rows.length > 0 ? spec.rows : null;
}
