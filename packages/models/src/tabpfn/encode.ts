import { isMissingValue } from "@tavolio/preprocessing";
import type { ColumnSchema, Table } from "@tavolio/table";
import { isUsableFeature } from "../local-tabular/adapter.js";
import { shuffled } from "../local-tabular/model.js";

/**
 * Table-wide half of TabPFN's preprocessing (what `tabpfn` does in `clean_data` + `detect_feature_modalities` + the ordinal
 * encoding step, with the TabPFN-3.5 inference config). The label-dependent half (constant removal, fingerprint, feature shuffle,
 * outlier clipping, all fitted on the context rows) is `buildTabPfnInputs` in inputs.ts.
 *
 *  1. Every cell is coerced to its column's type, so a column is never half numbers, half text: unparseable cells become blank.
 *  2. A numeric column with fewer than 4 distinct values (blank counts as one) is categorical once there are over 100 rows.
 *  3. Categoricals become ordinal codes (sorted, then permuted with a fixed seed: TabPFN is trained on shuffled codes, and the graph
 *     is never told which columns are categorical). Blank stays blank.
 *  4. A date becomes a running index plus Fourier terms (see `expandDate`), replacing skrub's DatetimeEncoder.
 * Not ported: free-text columns (TabPFN embeds them with tf-idf + SVD; here they are dropped by `isUsableFeature`).
 */

/** More columns than this cost time for little gain; the rest are dropped (and the user is told). */
export const TABPFN_MAX_FEATURES = 100;

const MIN_UNIQUE_FOR_NUMERICAL = 4;
const MIN_ROWS_TO_INFER_CATEGORICAL = 100;
const DAY_MS = 86_400_000;

/** Fourier harmonics per calendar period for a date column. A period whose columns come out constant (e.g. daily on whole dates) is dropped later. */
export const DATE_HARMONICS = { annual: 2, weekly: 2, daily: 1 } as const;

export interface TabPfnFrame {
  featureNames: string[];
  /** Per column: the sheet column it came from (a date expands into several columns, all with the same source). */
  source: string[];
  cols: number;
  /** Row-major rows×cols. Missing cells are NaN: TabPFN imputes and flags them itself. */
  matrix: Float32Array;
  /** Per column: an ordinal-coded category (exempt from outlier clipping). */
  categorical: boolean[];
  /** True when usable columns beyond TABPFN_MAX_FEATURES were left out. */
  truncated: boolean;
  /** Human-readable notes on cells that had to be coerced, for the result's warnings. */
  notes: string[];
}

const TRUE_WORDS = new Set(["true", "yes", "y", "t", "1"]);
const FALSE_WORDS = new Set(["false", "no", "n", "f", "0"]);

/** A number from whatever the sheet holds: 1234, "1,234", "$1,234.50", "12%", "(5)" → -5. Anything else is NaN. */
export function parseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "string" || isMissingValue(v)) return NaN;
  let s = v.trim();
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) s = paren[1]!;
  s = s.replace(/[$€£¥,%\s]/g, "");
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? (paren ? -n : n) : NaN;
}

function parseBoolean(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v === 1 || v === 0 ? v : NaN;
  if (typeof v !== "string") return NaN;
  const s = v.trim().toLowerCase();
  return TRUE_WORDS.has(s) ? 1 : FALSE_WORDS.has(s) ? 0 : NaN;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Wall-clock milliseconds (as if UTC), so a date means the same thing whatever the viewer's timezone. NaN when it isn't a date.
 * Dates the sheet reports as Date objects, and non-ISO strings ("3/5/2024"), are read in local time and then re-expressed as wall-clock.
 */
export function parseDateMs(v: unknown): number {
  const wallClock = (d: Date) =>
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? NaN : wallClock(v);
  if (typeof v !== "string" || isMissingValue(v)) return NaN;
  const s = v.trim();
  const iso = ISO_DATE.exec(s);
  if (iso) {
    const [y, mo, d, h, mi, sec] = iso.slice(1).map((g) => (g === undefined ? 0 : Number(g)));
    return Date.UTC(y!, mo! - 1, d!, h, mi, sec);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? wallClock(new Date(t)) : NaN;
}

/** Sorted distinct values → codes permuted by a seeded shuffle; undefined stays NaN. */
function ordinal<T extends string | number>(keys: Array<T | undefined>, seed: number): Float64Array {
  const distinct = [...new Set(keys.filter((k): k is T => k !== undefined))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const perm = shuffled(distinct.map((_, i) => i), seed);
  const code = new Map(distinct.map((k, i) => [k, perm[i]!]));
  return Float64Array.from(keys, (k) => (k === undefined ? NaN : code.get(k)!));
}

/** Distinct values counting blank as one value, as `Series.nunique(dropna=False)` does. */
function distinctCount(values: ArrayLike<number>): number {
  const seen = new Set<number>();
  for (let i = 0; i < values.length; i++) seen.add(values[i]!);   // NaN is one Set member
  return seen.size;
}

/**
 * A date as columns: days since the column's earliest date (the running index; relative so float32 keeps sub-minute precision),
 * then sin/cos pairs for the annual cycle (by calendar position in the year), the weekly cycle and the daily cycle.
 */
function expandDate(name: string, ms: Float64Array): Array<{ name: string; values: Float64Array }> {
  const rows = ms.length;
  let first = Infinity;
  for (let r = 0; r < rows; r++) if (ms[r]! < first) first = ms[r]!;
  const out: Array<{ name: string; values: Float64Array }> = [];
  const index = new Float64Array(rows).fill(NaN);
  const phases = {
    annual: new Float64Array(rows).fill(NaN),
    weekly: new Float64Array(rows).fill(NaN),
    daily: new Float64Array(rows).fill(NaN),
  };
  for (let r = 0; r < rows; r++) {
    const t = ms[r]!;
    if (Number.isNaN(t)) continue;
    index[r] = (t - first) / DAY_MS;
    const year = new Date(t).getUTCFullYear();
    const yearStart = Date.UTC(year, 0, 1);
    phases.annual[r] = (t - yearStart) / (Date.UTC(year + 1, 0, 1) - yearStart);
    phases.weekly[r] = (((t / DAY_MS) % 7) + 7) % 7 / 7;
    phases.daily[r] = (((t % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
  }
  out.push({ name: `${name} (days)`, values: index });
  for (const period of ["annual", "weekly", "daily"] as const) {
    for (let k = 1; k <= DATE_HARMONICS[period]; k++) {
      for (const fn of ["sin", "cos"] as const) {
        out.push({ name: `${name} (${period} ${fn}${k})`, values: phases[period].map((p) => Math[fn](2 * Math.PI * k * p)) });
      }
    }
  }
  return out;
}

/**
 * Table → one numeric matrix the way TabPFN expects its input. Columns that carry no signal (identifiers, text, mostly empty,
 * constant) are left out; the rest are coerced, typed, categorised and (for dates) expanded as described above.
 */
export function encodeForTabPfn(table: Table, schema: ColumnSchema[], target: string, seed = 0): TabPfnFrame {
  const usable = schema.filter((c) => c.name !== target && isUsableFeature(c, table));
  const colIndex = new Map(table.columns.map((c, i) => [c.name, i]));
  const rows = table.rows.length;
  const notes: string[] = [];
  const built: Array<{ name: string; source: string; values: Float64Array; categorical: boolean }> = [];

  for (const col of usable) {
    const idx = colIndex.get(col.name)!;
    const cells = table.rows.map((row) => row[idx]);
    const present = cells.filter((v) => !isMissingValue(v));
    const seedFor = seed * 7919 + built.length + 1;

    if (col.type === "numeric" || col.type === "boolean") {
      const parse = col.type === "numeric" ? parseNumber : parseBoolean;
      const values = Float64Array.from(cells, (v) => (isMissingValue(v) ? NaN : parse(v)));
      const bad = present.filter((v) => Number.isNaN(parse(v))).length;
      if (bad > 0) notes.push(`${bad} cell${bad === 1 ? "" : "s"} in "${col.name}" weren't ${col.type === "numeric" ? "numbers" : "yes/no values"} and were treated as blank.`);
      const nUnique = distinctCount(values);
      if (nUnique <= 1) continue;
      const categorical = rows > MIN_ROWS_TO_INFER_CATEGORICAL && nUnique < MIN_UNIQUE_FOR_NUMERICAL;
      built.push({ name: col.name, source: col.name, values: categorical ? ordinal(Array.from(values, (v) => (Number.isNaN(v) ? undefined : v)), seedFor) : values, categorical });
    } else if (col.type === "datetime") {
      const ms = Float64Array.from(cells, (v) => (isMissingValue(v) ? NaN : parseDateMs(v)));
      const bad = present.filter((v) => Number.isNaN(parseDateMs(v))).length;
      if (bad > 0) notes.push(`${bad} cell${bad === 1 ? "" : "s"} in "${col.name}" weren't dates and were treated as blank.`);
      if (distinctCount(ms) <= 1) continue;
      for (const part of expandDate(col.name, ms)) {
        // Constant over the dates that exist (blank dates are already marked by the other columns): no signal.
        if (distinctCount(part.values.filter((v) => !Number.isNaN(v))) > 1) built.push({ ...part, source: col.name, categorical: false });
      }
    } else {
      // Categorical, ordinal, (text that isUsableFeature let through): compared trimmed and case-insensitively.
      const keys = cells.map((v) => (isMissingValue(v) ? undefined : String(v).trim().toLowerCase()));
      if (new Set(keys).size <= 1) continue;
      built.push({ name: col.name, source: col.name, values: ordinal(keys, seedFor), categorical: true });
    }
  }

  const kept = built.slice(0, TABPFN_MAX_FEATURES);
  const cols = kept.length;
  const matrix = new Float32Array(rows * cols);
  kept.forEach((col, j) => {
    for (let r = 0; r < rows; r++) matrix[r * cols + j] = col.values[r]!;
  });
  return {
    featureNames: kept.map((c) => c.name),
    source: kept.map((c) => c.source),
    cols,
    matrix,
    categorical: kept.map((c) => c.categorical),
    truncated: built.length > kept.length,
    notes,
  };
}
