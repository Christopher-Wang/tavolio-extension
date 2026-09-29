import { columnTopValues, isMissingValue, applySchema, inferSchema, profileColumns, type ColumnProfile } from "@tavolio/preprocessing";
import { inferTask, isPredictError, predictTable, type PredictStage } from "@tavolio/prediction";
import type { PredictionResult, Task } from "@tavolio/models";
import { columnValues, fromValues, selectColumns, type ColumnSchema, type Table } from "@tavolio/table";
import type { PredictionColumn, SheetTable, TableRef, WritePlan } from "./host.js";

export const PREDICTION_SUFFIX = " (Tavolio prediction)";
export const CONFIDENCE_SUFFIX = " (Tavolio confidence)";

/** Columns Tavolio wrote on a previous run: hidden from analysis so they never leak into features. */
export function isTavolioColumn(name: string): boolean {
  return name.endsWith(PREDICTION_SUFFIX) || name.endsWith(CONFIDENCE_SUFFIX);
}

export interface Analysis {
  sheet: SheetTable;
  ref: TableRef;
  table: Table;
  schema: ColumnSchema[];
  profiles: ColumnProfile[];
  /** Column name -> 0-based offset within the sheet table. */
  offsets: Map<string, number>;
}

function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Sheet values -> analyzed Table. Blank headers get "Column C"; duplicates get " (2)". */
export function analyze(sheet: SheetTable): Analysis {
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
  const schema = inferSchema(table).columns;
  const profiles = profileColumns(table, schema);
  const { values: _values, address: _address, ...ref } = sheet;
  return { sheet, ref, table, schema, profiles, offsets: new Map(keep.map((k) => [k.n, k.i])) };
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
      classes: Array<{ value: string; count: number }>;
      labeled: number;
      blank: number;
      features: number;
    }
  | { ok: false; title: string; detail: string; counts?: Array<{ value: string; count: number }> };

/** Same task inference the engine uses, run before Predict so problems show up immediately. */
export function previewTarget(a: Analysis, target: string, excluded: ReadonlySet<string>): TargetPreview {
  const withSchema = applySchema(a.table, { columns: a.schema });
  const values = columnValues(withSchema, target);
  const blank = values.filter(isMissingValue).length;
  const features = a.profiles.filter((p) => p.name !== target && p.role === "feature" && !excluded.has(p.name)).length;
  try {
    const task = inferTask(a.schema, target, values);
    const classes = task.type === "classification" ? columnTopValues(a.table, target).slice(0, 4) : [];
    return { ok: true, task, classes, labeled: values.length - blank, blank, features };
  } catch (e) {
    if (isPredictError(e)) return { ok: false, title: e.title, detail: e.detail, counts: e.counts };
    return { ok: false, title: "This column can't be predicted yet", detail: String(e) };
  }
}

export function runPrediction(
  a: Analysis,
  target: string,
  excluded: ReadonlySet<string>,
  onProgress: (stage: PredictStage) => void | Promise<void>,
): Promise<PredictionResult> {
  const names = a.table.columns.map((c) => c.name).filter((n) => n === target || !excluded.has(n));
  return predictTable({ table: selectColumns(a.table, names), target, onProgress });
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

export function buildWritePlan(a: Analysis, result: PredictionResult, destination: Destination): WritePlan {
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
        return isClass && conf !== undefined
          ? `Predicted by Tavolio · ${Math.round(conf * 100)}% confidence · ${today}`
          : `Predicted by Tavolio · ${today}`;
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
  if (isClass && result.confidences) {
    const conf = result.confidences;
    columns.push({
      header: target + CONFIDENCE_SUFFIX,
      note: "How sure Tavolio is about each prediction.",
      values: conf.map((c, i) => (rows.has(i) ? c : null)),
      format: "percent",
    });
  }
  if (destination === "new-sheet") {
    return { mode: "new-sheet", table: a.ref, columns, sheetName: "Tavolio Predictions" };
  }
  return { mode: "new-columns", table: a.ref, columns };
}

export type { ColumnProfile, PredictStage };
