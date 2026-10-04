import { formatNumber } from "./numfmt.js";
import { columnTopValues, detectDateFrequency, isMissingValue, applySchema, inferSchema, profileColumns, type ColumnProfile } from "@tavolio/preprocessing";
import { inferTask, isPredictError, predictTable, type PredictStage } from "@tavolio/prediction";
import type { LoadProgress, PredictionResult, Task, ValidationStrategy } from "@tavolio/models";
import { columnValues, fromValues, selectColumns, type ColumnSchema, type ColumnType, type Table } from "@tavolio/table";
import type { PredictionColumn, SheetTable, TableRef, WritePlan } from "./host.js";

export const PREDICTION_SUFFIX = " (Tavolio prediction)";
export const CONFIDENCE_SUFFIX = " (Tavolio confidence)";
export const EXPLANATION_SUFFIX = " (SHAP)";
export const LOWER_SUFFIX = " (Tavolio lower)";
export const UPPER_SUFFIX = " (Tavolio upper)";

/** Columns Tavolio wrote on a previous run: hidden from analysis so they never leak into features. */
export function isTavolioColumn(name: string): boolean {
  return name.endsWith(PREDICTION_SUFFIX) || name.endsWith(CONFIDENCE_SUFFIX) || name.endsWith(EXPLANATION_SUFFIX) || name.endsWith(LOWER_SUFFIX) || name.endsWith(UPPER_SUFFIX);
}

export interface Analysis {
  sheet: SheetTable;
  ref: TableRef;
  table: Table;
  schema: ColumnSchema[];
  profiles: ColumnProfile[];
  /** Column name -> 0-based offset within the sheet table. */
  offsets: Map<string, number>;
  typeOverrides: Record<string, ColumnType>;
}

/** Share of non-empty cells across the whole table, 0..1. */
export function completeness(a: Analysis): number {
  if (a.profiles.length === 0) return 1;
  return 1 - a.profiles.reduce((sum, p) => sum + p.missingRate, 0) / a.profiles.length;
}

export interface ColumnStats {
  kind: "numeric" | "date" | "categorical" | "none";
  /** Numeric: formatted lines like ["Range", "18 – 84"]. */
  lines: Array<[string, string]>;
  /** Categories only: rows per distinct value, most common first (count is rows, share is of the non-blank rows). */
  top: Array<{ value: string; count: number; share: number; variants: Array<{ spelling: string; count: number }> }>;
  /** How many distinct values there are beyond `top`. */
  more?: number;
  /** Numeric columns: counts per equal-width bin. */
  histogram?: { bins: number[]; min: number; max: number } | null;
}

function median(sorted: number[]): number {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

const fmt = formatNumber;

/** Categories listed in a column's breakdown before "and N other values". */
const SHOWN_CATEGORIES = 8;

/** The lightweight per-column facts shown when a column is opened in Data. */
export function columnStats(a: Analysis, name: string): ColumnStats {
  const p = a.profiles.find((x) => x.name === name);
  const raw = columnValues(a.table, name).filter((v) => !isMissingValue(v));
  if (!p || raw.length === 0) return { kind: "none", lines: [], top: [] };
  if (p.type === "numeric") {
    const nums = raw.map(Number).filter(Number.isFinite).sort((x, y) => x - y);
    if (nums.length === 0) return { kind: "none", lines: [], top: [] };
    const mean = nums.reduce((x, y) => x + y, 0) / nums.length;
    return {
      kind: "numeric",
      lines: [
        ["Range", `${fmt(nums[0]!)} – ${fmt(nums[nums.length - 1]!)}`],
        ["Median", fmt(median(nums))],
        ["Mean", fmt(mean)],
      ],
      top: [],
      histogram: histogramOf(nums),
    };
  }
  if (p.type === "datetime") {
    const times = raw.map((v) => Date.parse(String(v))).filter(Number.isFinite).sort((x, y) => x - y);
    if (times.length === 0) return { kind: "none", lines: [], top: [] };
    const d = (t: number) => new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
    const frequency = detectDateFrequency(times);
    return {
      kind: "date",
      lines: [["Earliest", d(times[0]!)], ["Latest", d(times[times.length - 1]!)], ...(frequency ? [["Frequency", frequency] as [string, string]] : [])],
      top: [],
    };
  }
  // Only real categories get a breakdown: free text and identifiers have one row per value, which says nothing.
  const category = p.type === "categorical" || p.type === "ordinal" || p.type === "boolean";
  if (!category || p.uniqueCount >= raw.length) return { kind: "none", lines: [], top: [] };
  const all = columnTopValues(a.table, name);
  const top = all.slice(0, SHOWN_CATEGORIES).map((c) => ({ value: c.value, count: c.count, share: c.count / raw.length, variants: c.variants }));
  return { kind: "categorical", lines: [], top, more: Math.max(0, p.uniqueCount - top.length) };
}

function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Sheet values -> analyzed Table. Blank headers get "Column C"; duplicates get " (2)". */
export function analyze(sheet: SheetTable, typeOverrides: Record<string, ColumnType> = {}): Analysis {
  const [rawHeader = [], ...rows] = sheet.values;
  const seen = new Map<string, number>();
  const names = rawHeader.map((h, i) => {
    let name = String(h ?? "").trim() || `Column ${columnLetter(sheet.column + i)}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
  const keep = names.map((n, i) => ({ n, i })).filter(({ n }) => !isTavolioColumn(n));
  const table = fromValues(
    keep.map((k) => k.n),
    rows.map((r) => keep.map((k) => r[k.i])),
  );
  const schema = inferSchema(table).columns.map((c) =>
    typeOverrides[c.name] ? { ...c, type: typeOverrides[c.name]!, confidence: 1 } : c,
  );
  const profiles = profileColumns(table, schema);
  const { values: _values, address: _address, ...ref } = sheet;
  return { sheet, ref, table, schema, profiles, offsets: new Map(keep.map((k) => [k.n, k.i])), typeOverrides };
}

/** Sensible first guess: the last column Tavolio would actually use. */
export function defaultTarget(a: Analysis): string {
  const usable = a.profiles.filter((p) => p.role === "feature");
  return (usable[usable.length - 1] ?? a.profiles[a.profiles.length - 1])?.name ?? "";
}

export type TargetPreview =
  | {
      ok: true;
      task: Task;
      /** Top classes with counts (classification only). */
      classes: Array<{ value: string; count: number; variants: Array<{ spelling: string; count: number }> }>;
      /** Regression only: counts per equal-width bin of the known values. */
      histogram: { bins: number[]; min: number; max: number } | null;
      labeled: number;
      blank: number;
      features: number;
    }
  | { ok: false; title: string; detail: string; counts?: Array<{ value: string; count: number }> };

const HISTOGRAM_BINS = 14;

function histogramOf(values: unknown[]): { bins: number[]; min: number; max: number } | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  let min = nums[0]!;
  let max = nums[0]!;
  for (const n of nums) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  const width = (max - min) / HISTOGRAM_BINS || 1;
  for (const n of nums) bins[Math.min(HISTOGRAM_BINS - 1, Math.floor((n - min) / width))]!++;
  return { bins, min, max };
}

/** Same task inference the engine uses, run before Predict so problems show up immediately. */
export function previewTarget(a: Analysis, target: string, excluded: ReadonlySet<string>): TargetPreview {
  const withSchema = applySchema(a.table, { columns: a.schema });
  const values = columnValues(withSchema, target);
  const blank = values.filter(isMissingValue).length;
  const features = a.profiles.filter((p) => p.name !== target && p.role === "feature" && !excluded.has(p.name)).length;
  try {
    const task = inferTask(a.schema, target, values);
    const classes = task.type === "classification" ? columnTopValues(a.table, target).slice(0, 4) : [];
    const histogram = task.type === "regression" ? histogramOf(values) : null;
    return { ok: true, task, classes, histogram, labeled: values.length - blank, blank, features };
  } catch (e) {
    if (isPredictError(e)) return { ok: false, title: e.title, detail: e.detail, counts: e.counts };
    return { ok: false, title: "This column can't be predicted yet", detail: String(e) };
  }
}

export function runPrediction(
  a: Analysis,
  target: string,
  excluded: ReadonlySet<string>,
  validation: ValidationStrategy,
  onProgress: (stage: PredictStage, detail?: LoadProgress) => void | Promise<void>,
  modelId?: string,
  explain?: boolean,
  predictRows?: number[],
  baseline?: boolean,
  interval?: number,
): Promise<PredictionResult> {
  const names = a.table.columns.map((c) => c.name).filter((n) => n === target || !excluded.has(n));
  return predictTable({ table: selectColumns(a.table, names), target, modelId, typeOverrides: a.typeOverrides, validation, explain, predictRows, baseline, interval, onProgress });
}

/**
 * One "<column> (SHAP)" column per feature the model used: how far that column pushed each predicted row's prediction
 * (classification: the predicted outcome's probability, 0.1 = +10 points; regression: the target's own units).
 * Null when the result has no explanations (turned off, or the model couldn't give them).
 */
export async function explanationColumns(a: Analysis, result: PredictionResult): Promise<PredictionColumn[] | null> {
  if (!result.explainRows) return null;
  const rows = [...predictedRows(result)].sort((x, y) => x - y);
  if (rows.length === 0) return null;
  const explained = await result.explainRows(rows);
  const used = new Set(explained[0]?.contributions.map((c) => c.name));
  const today = new Date().toISOString().slice(0, 10);
  const unit = result.task.type === "classification" ? "the change in the predicted outcome's probability (0.1 = +10 points)" : `the change in the predicted ${result.target}, in its own units`;
  return a.table.columns
    .map((c) => c.name)
    .filter((name) => used.has(name))
    .map((name) => {
      const values: Array<number | null> = new Array(result.predictions.length).fill(null);
      explained.forEach((e) => {
        const phi = e.contributions.find((c) => c.name === name)?.phi;
        values[e.row] = phi === undefined ? null : Math.round(phi * 10000) / 10000;
      });
      return {
        header: name + EXPLANATION_SUFFIX,
        note: `Added by Tavolio on ${today}. How much "${name}" pushed each prediction: ${unit}.`,
        values,
      };
    });
}

/** First row and column span of an A1 range such as "F1:G201" (sheet name already stripped); null when it isn't one. */
export function addressBounds(address: string): { top: number; left: number; right: number } | null {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?\d+)?$/.exec(address);
  if (!m) return null;
  const col = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { top: Number(m[2]), left: col(m[1]!), right: col(m[3] ?? m[1]!) };
}

export type Destination = "new-columns" | "new-sheet" | "fill-blanks";

/**
 * Rows that get a prediction: the blank-target rows when there are any
 * (predicting rows you already know is noise), otherwise every row.
 */
function predictedRows(result: PredictionResult): Set<number> {
  const blank = result.newRowIndexes ?? [];
  return new Set(blank.length > 0 ? blank : result.predictions.map((_, i) => i));
}

function cell(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : String(v);
}

export function buildWritePlan(a: Analysis, result: PredictionResult, destination: Destination, extra: PredictionColumn[] = [], includeProbabilities = true): WritePlan {
  const target = result.target;
  const rows = predictedRows(result);
  const isClass = result.task.type === "classification";
  const today = new Date().toISOString().slice(0, 10);
  const featureCount = a.profiles.filter((p) => p.name !== target && p.role === "feature").length;

  if (destination === "fill-blanks") {
    const blank = new Set(result.newRowIndexes ?? []);
    return {
      mode: "fill-blanks",
      table: a.ref,
      targetOffset: a.offsets.get(target)!,
      values: result.predictions.map((p, i) => (blank.has(i) ? cell(p) : null)),
      notes: result.predictions.map((_, i) => {
        if (!blank.has(i)) return null;
        const conf = result.confidences?.[i];
        const iv = result.intervals?.[i];
        const range = iv ? ` · ${Math.round((result.intervalLevel ?? 0.95) * 100)}% likely between ${cell(iv.lower)} and ${cell(iv.upper)}` : "";
        return isClass && conf !== undefined && includeProbabilities
          ? `Predicted by Tavolio · ${Math.round(conf * 100)}% confidence · ${today}`
          : `Predicted by Tavolio${range} · ${today}`;
      }),
    };
  }

  const columns: PredictionColumn[] = [
    {
      header: target + PREDICTION_SUFFIX,
      note: `Added by Tavolio on ${today}. Predicts "${target}" from ${featureCount} other columns.`,
      values: result.predictions.map((p, i) => (rows.has(i) ? cell(p) : null)),
    },
  ];
  if (isClass && result.confidences && includeProbabilities) {
    const conf = result.confidences;
    columns.push({
      header: target + CONFIDENCE_SUFFIX,
      note: "How sure Tavolio is about each prediction.",
      values: conf.map((c, i) => (rows.has(i) ? c : null)),
      format: "percent",
    });
  }
  if (result.intervals) {
    const iv = result.intervals;
    const level = Math.round((result.intervalLevel ?? 0.95) * 100);
    columns.push(
      {
        header: target + LOWER_SUFFIX,
        note: `Added by Tavolio on ${today}. Low end of the ${level}% prediction interval: Tavolio expects the real value to land between the low and high ends ${level}% of the time.`,
        values: iv.map((b, i) => (rows.has(i) && b ? Math.round(b.lower * 10000) / 10000 : null)),
      },
      {
        header: target + UPPER_SUFFIX,
        note: `Added by Tavolio on ${today}. High end of the ${level}% prediction interval.`,
        values: iv.map((b, i) => (rows.has(i) && b ? Math.round(b.upper * 10000) / 10000 : null)),
      },
    );
  }
  columns.push(...extra);
  if (destination === "new-sheet") {
    return { mode: "new-sheet", table: a.ref, columns, sheetName: "Tavolio Predictions" };
  }
  return { mode: "new-columns", table: a.ref, columns };
}

export type { ColumnProfile, PredictStage };
