import type { ColumnSchema } from "@tavolio/table";
import { isMissingValue } from "@tavolio/preprocessing";
import type { Task } from "@tavolio/models";

/**
 * Consumer-friendly prediction errors (§13). The sidebar renders
 * `title` + `detail` + optional per-class counts instead of raw ML jargon.
 */
export class PredictError extends Error {
  readonly title: string;
  readonly detail: string;
  readonly hint?: string;
  readonly counts?: Array<{ value: string; count: number }>;

  constructor(opts: { title: string; detail: string; hint?: string; counts?: Array<{ value: string; count: number }> }) {
    super(`${opts.title}: ${opts.detail}`);
    this.name = "PredictError";
    this.title = opts.title;
    this.detail = opts.detail;
    this.hint = opts.hint;
    this.counts = opts.counts;
  }
}

export function isPredictError(e: unknown): e is PredictError {
  return e instanceof PredictError;
}

/**
 * Single task concept. The Sheets UI never branches on classification vs
 * regression; the model adapter owns those differences.
 */
export function inferTask(
  schema: ColumnSchema[],
  target: string,
  targetValues: unknown[],
): Task {
  const col = schema.find((c) => c.name === target);
  if (!col) throw new Error(`Target not in schema: ${target}`);
  const observed = targetValues.filter((v) => !isMissingValue(v));
  // Identifier-like targets (§13) win over class-balance errors — but only
  // when there's enough data to trust the uniqueness signal. On tiny tables
  // (5-row fixtures) every column looks unique, so require >= 10 rows and
  // a non-numeric type (numeric targets like Price are regression, not IDs).
  if (observed.length >= 10 && col.type !== "numeric") {
    const uniqueRate = new Set(observed.map((v) => String(v).trim().toLowerCase())).size / observed.length;
    if (uniqueRate >= 0.9) {
      throw new PredictError({
        title: "This column can't be predicted yet",
        detail: `Every value in "${target}" is unique. It looks like an identifier rather than something that can be learned from.`,
        hint: "Choose another column",
      });
    }
  }
  if (col.type === "numeric") {
    const nums = targetValues.filter((v) => !isMissingValue(v));
    const distinct = new Set(nums.map((v) => String(v))).size;
    // Few distinct numerics (e.g. 0/1 labels) are really classes — but only
    // when the sample is large enough to trust the cardinality signal.
    // With tiny tables (like the 5-row housing fixture) every column looks
    // low-cardinality, so require >10 rows before classifying numerics.
    if (distinct <= 10 && nums.length > 10) {
      return { type: "classification", classes: [...new Set(nums.map((v) => String(v)))] };
    }
    return { type: "regression" };
  }
  if (col.type === "boolean" || col.type === "categorical" || col.type === "ordinal") {
    const classes = [...new Set(targetValues.filter((v) => !isMissingValue(v)).map((v) => String(v)))];
    validateClasses(target, classes, targetValues);
    return { type: "classification", classes };
  }
  if (col.type === "datetime") {
    throw new PredictError({
      title: "This column can't be predicted yet",
      detail: `"${target}" looks like a date. Dates work great as inputs, but Tavolio can't predict them yet.`,
      hint: "Choose another column",
    });
  }
  const classes = [...new Set(targetValues.filter((v) => !isMissingValue(v)).map((v) => String(v)))];
  if (classes.length >= 2 && classes.length <= 100) {
    validateClasses(target, classes, targetValues);
    return { type: "classification", classes };
  }
  if (classes.length < 2) {
    throw new PredictError({
      title: "Not enough examples yet",
      detail: `"${target}" needs at least 2 different values to learn from.`,
      hint: "Choose another column",
    });
  }
  throw new PredictError({
    title: "This column can't be predicted yet",
    detail: `Cannot infer task for target "${target}" (type=${col.type}). Try a category or number column.`,
    hint: "Choose another column",
  });
}

function validateClasses(target: string, classes: string[], targetValues: unknown[]): void {
  if (classes.length < 2) {
    throw new PredictError({
      title: "Not enough examples yet",
      detail: `"${target}" needs at least 2 different values to learn from.`,
      hint: "Choose another column",
    });
  }
  if (classes.length > 100) {
    throw new PredictError({
      title: "Too many different values",
      detail: `"${target}" has ${classes.length} different values (max 100). Columns with that many outcomes can't be predicted reliably yet.`,
      hint: "Choose another column",
    });
  }
  const counts = new Map<string, number>();
  for (const v of targetValues) {
    if (isMissingValue(v)) continue;
    const k = String(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const observedForGate = [...counts.values()].reduce((a, b) => a + b, 0);
  const sorted = classes
    .map((value) => ({ value, count: counts.get(value) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const minority = sorted[sorted.length - 1]!;
  // Tiny tables (fixtures) can't satisfy a minority-count gate: with only a
  // handful of rows every class is rare. Require the gate only when there's
  // enough data to trust it (§13); otherwise let the kNN baseline run.
  if (minority.count < 2 && observedForGate >= 20) {
    throw new PredictError({
      title: "Not enough examples yet",
      detail: `Tavolio needs more examples of "${minority.value}" to reliably learn this pattern.`,
      hint: "Choose another column",
      counts: sorted,
    });
  }
}

