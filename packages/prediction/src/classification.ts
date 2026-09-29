import type { ColumnSchema } from "@tavolio/table";
import { isMissingValue } from "@tavolio/preprocessing";
import type { Task } from "@tavolio/models";

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
    if (classes.length < 2) throw new Error(`Target "${target}" needs at least 2 classes`);
    if (classes.length > 100) throw new Error(`Target "${target}" has ${classes.length} classes (max 100)`);
    return { type: "classification", classes };
  }
  if (col.type === "datetime") {
    throw new Error(`Target "${target}" is datetime — pick a categorical or numeric column`);
  }
  const classes = [...new Set(targetValues.filter((v) => !isMissingValue(v)).map((v) => String(v)))];
  if (classes.length >= 2 && classes.length <= 100) return { type: "classification", classes };
  throw new Error(`Cannot infer task for target "${target}" (type=${col.type})`);
}
