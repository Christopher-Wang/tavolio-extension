import type { ColumnType } from "@tavolio/table";

const COLORS: Record<ColumnType, string> = {
  numeric: "#e8f0fe",
  categorical: "#fef7e0",
  ordinal: "#fef7e0",
  boolean: "#e6f4ea",
  datetime: "#f3e8fd",
  text: "#f1f3f4",
};

/** Header background per inferred type when writing results. */
export function typeColor(type: ColumnType): string {
  return COLORS[type];
}
