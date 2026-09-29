/**
 * Canonical representation of a spreadsheet table.
 * Everything downstream operates on this, never on host ranges.
 */

export type ColumnType =
  | "numeric"
  | "categorical"
  | "ordinal"
  | "boolean"
  | "datetime"
  | "text";

export interface ColumnSchema {
  name: string;
  type: ColumnType;
  confidence: number;
  nullable: boolean;
}

export interface TableSchema {
  columns: ColumnSchema[];
}

/** Row-major table. rows[r][c] aligns with columns[c]. */
export interface Table {
  columns: ColumnSchema[];
  rows: unknown[][];
}

export interface ProfiledTable extends Table {
  warnings: string[];
}
