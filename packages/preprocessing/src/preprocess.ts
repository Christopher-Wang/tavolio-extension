import { columnValues, type ColumnSchema, type Table } from "@tavolio/table";
import { inferColumnType } from "./inferColumnType.js";
import { inferNullable } from "./missingValues.js";

export interface InferredSchema {
  columns: ColumnSchema[];
}

/** Universal schema inference: "Plan is categorical" as a fact about the table. */
export function inferSchema(table: Table): InferredSchema {
  const columns: ColumnSchema[] = table.columns.map((col) => {
    const values = columnValues(table, col.name);
    const { type, confidence } = inferColumnType(col.name, values);
    return {
      name: col.name,
      type,
      confidence: round2(confidence),
      nullable: inferNullable(values),
    };
  });
  return { columns };
}

/** Apply an inferred schema to a table (returns a new Table). */
export function applySchema(table: Table, schema: InferredSchema): Table {
  if (schema.columns.length !== table.columns.length) {
    throw new Error("Schema/column count mismatch");
  }
  return {
    columns: table.columns.map((c, i) => ({
      ...c,
      ...schema.columns[i]!,
    })),
    rows: table.rows,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
