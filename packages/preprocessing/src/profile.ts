import type { ColumnSchema, ColumnType, Table } from "@tavolio/table";
import { columnValues } from "@tavolio/table";
import { inferNullable, isMissingValue, missingRate, nonMissing } from "./missingValues.js";
import { inferColumnType } from "./inferColumnType.js";
import { categoricalStats } from "./categorical.js";
import { exemptFromIdentifierRule } from "./identifier.js";

export type ColumnRole = "feature" | "ignore";

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  confidence: number;
  nullable: boolean;
  missingRate: number;
  uniqueCount: number;
  uniqueRate: number;
  examples: string[];
  role: ColumnRole;
  reason: string;
}

function examplesOf(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of nonMissing(values)) {
    const s = String(v);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s.length > 40 ? `${s.slice(0, 40)}…` : s);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Universal facts about each column: missingness, cardinality, examples,
 * and whether the column looks usable as a model feature.
 *
 * Deliberately model-agnostic — no vocabularies or encodings here.
 * The sidebar renders "Preparing your data" (§4) directly from this.
 */
export function profileColumns(table: Table, schema: ColumnSchema[]): ColumnProfile[] {
  const n = table.rows.length;
  return schema.map((col) => {
    const values = columnValues(table, col.name);
    const observed = nonMissing(values);
    const uniq = new Set(observed.map((v) => String(v).trim().toLowerCase()));
    const uniqueCount = uniq.size;
    const uniqueRate = observed.length === 0 ? 0 : uniqueCount / observed.length;
    const mRate = missingRate(values);
    const examples = examplesOf(values);
    const decision = decideRole(col, { uniqueCount, uniqueRate, missingRate: mRate, n, exempt: exemptFromIdentifierRule(col.type, observed) });
    return {
      name: col.name,
      type: col.type,
      confidence: col.confidence,
      nullable: inferNullable(values),
      missingRate: round4(mRate),
      uniqueCount,
      uniqueRate: round4(uniqueRate),
      examples,
      role: decision.role,
      reason: decision.reason,
    };
  });
}

function decideRole(
  col: ColumnSchema,
  stats: { uniqueCount: number; uniqueRate: number; missingRate: number; n: number; exempt: boolean },
): { role: ColumnRole; reason: string } {
  // Unique-per-row values are identifiers, not learnable patterns (§13), except dates and continuous numbers.
  if (stats.n > 0 && stats.uniqueCount === stats.n && stats.n >= 3 && !stats.exempt) {
    return { role: "ignore", reason: "Looks like an identifier — every value is unique, so it won't be used." };
  }
  if (col.type === "text") {
    return { role: "ignore", reason: "Free text isn't supported by this model, so it will be ignored." };
  }
  if (stats.missingRate >= 0.6 && stats.n >= 5) {
    return { role: "ignore", reason: `${Math.round(stats.missingRate * 100)}% missing — too sparse to help, so it will be ignored.` };
  }
  if (col.type === "datetime") {
    return { role: "feature", reason: "Recognized as a date." };
  }
  return { role: "feature", reason: "Ready to use." };
}

/** Top values for the column-detail view (§2). */
export function columnTopValues(table: Table, name: string): ReturnType<typeof categoricalStats>["topValues"] {
  return categoricalStats(columnValues(table, name)).topValues;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export type { ColumnType };