import type { Table } from "./types.js";

/** Lightweight structural validation. Type inference lives in @tavolio/preprocessing. */
export function validateTable(table: Table): string[] {
  const warnings: string[] = [];
  if (table.columns.length === 0) warnings.push("Table has no columns.");
  if (table.rows.length === 0) warnings.push("Table has no rows.");
  const names = table.columns.map((c) => c.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  for (const d of new Set(dupes)) warnings.push(`Duplicate column name: ${d}`);
  for (const [r, row] of table.rows.entries()) {
    if (row.length !== table.columns.length) {
      throw new Error(
        `Row ${r} has ${row.length} cells, expected ${table.columns.length}`,
      );
    }
  }
  return warnings;
}
