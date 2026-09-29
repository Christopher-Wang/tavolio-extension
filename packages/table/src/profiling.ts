import { validateTable } from "./schema.js";
import type { ProfiledTable, Table } from "./types.js";

/** Attach structural warnings without changing schema. Profiling (type inference) is separate. */
export function profile(table: Table): ProfiledTable {
  const warnings = validateTable(table);
  return { ...table, warnings };
}
