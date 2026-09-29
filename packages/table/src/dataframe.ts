import type { Table } from "./types.js";

export function columnIndex(table: Table, name: string): number {
  const idx = table.columns.findIndex((c) => c.name === name);
  if (idx === -1) throw new Error(`Unknown column: ${name}`);
  return idx;
}

export function columnValues(table: Table, name: string): unknown[] {
  const idx = columnIndex(table, name);
  return table.rows.map((row) => row[idx]);
}

export function selectColumns(table: Table, names: string[]): Table {
  const indexes = names.map((n) => columnIndex(table, n));
  return {
    columns: indexes.map((i) => table.columns[i]!),
    rows: table.rows.map((row) => indexes.map((i) => row[i])),
  };
}

export function dropColumn(table: Table, name: string): Table {
  const idx = columnIndex(table, name);
  return {
    columns: table.columns.filter((_, i) => i !== idx),
    rows: table.rows.map((row) => row.filter((_, i) => i !== idx)),
  };
}

/** Build a Table from a header row + 2D values (e.g. Sheets Range.getValues()). */
export function fromValues(
  header: unknown[],
  values: unknown[][],
  columns?: Table["columns"],
): Table {
  const cols =
    columns ??
    header.map((h) => ({
      name: String(h ?? ""),
      type: "text" as const,
      confidence: 0,
      nullable: true,
    }));
  if (values.some((r) => r.length !== cols.length)) {
    throw new Error("Header/row width mismatch");
  }
  return { columns: cols, rows: values };
}
