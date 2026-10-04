/**
 * Everything the UI needs from a spreadsheet host. Google Sheets and Excel
 * each implement this in ~100 lines; the UI never branches on which host
 * it's running in.
 */

export type HostKind = "sheets" | "excel" | "dev";

/** Where a table lives. Rows/columns are 1-based; `rows` counts data rows (header excluded). */
export interface TableRef {
  sheetName: string;
  row: number;
  column: number;
  rows: number;
  columns: number;
}

export interface SheetTable extends TableRef {
  /** A1 notation of the whole table including the header, e.g. "A1:E201". */
  address: string;
  /** Header row + data rows. Dates arrive as ISO strings. */
  values: unknown[][];
}

/** The cell the user most recently clicked (1-based column and row). */
export interface ActiveCell {
  sheetName: string;
  column: number;
  /** 1-based sheet row. Optional: a host that can't say just drives column clicks. */
  row?: number;
}

export interface PredictionColumn {
  header: string;
  /** Short note attached to the header cell ("Added by Tavolio …"). */
  note: string;
  /** One value per data row; null leaves the cell empty. */
  values: Array<string | number | null>;
  format?: "percent";
}

export type WritePlan =
  /** Nondestructive default: insert columns right of the table (or reuse Tavolio's own). */
  | { mode: "new-columns"; table: TableRef; columns: PredictionColumn[] }
  /** Copy the table to a new sheet with the prediction columns appended. */
  | { mode: "new-sheet"; table: TableRef; columns: PredictionColumn[]; sheetName: string }
  /** Write only into blank cells of the target column; never touches existing values or formulas. */
  | {
      mode: "fill-blanks";
      table: TableRef;
      /** 0-based offset of the target column within the table. */
      targetOffset: number;
      values: Array<string | number | null>;
      notes: Array<string | null>;
    };

export interface WriteResult {
  sheetName: string;
  /** A1 range written; "" when there was nothing to write (fill-blanks found no blank cells). */
  address: string;
}

export type HostErrorCode = "no-selection" | "no-table";

/** Shown when nothing usable is selected. One wording for every host. */
export const NO_TABLE_MESSAGE = "Select your table (any cell inside it is enough), then click Use current selection.";

export class HostError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}

export interface HostBridge {
  kind: HostKind;
  /** "native": selection events; "polled": the host has none, so the bridge polls. */
  selectionEvents: "native" | "polled";
  /** The table around the user's selection (the whole data region if they clicked one cell). */
  readTable(): Promise<SheetTable>;
  /** Highlight one table column (0-based offset) in the grid. */
  selectColumn(table: TableRef, offset: number): Promise<void>;
  /**
   * 0-based data-row indexes of the table that the user's current selection covers
   * (header excluded, rows outside the table ignored). Empty when none.
   */
  readSelectedRows(table: TableRef): Promise<number[]>;
  /** Subscribe to active-cell changes. Returns an unsubscribe function. */
  watchActiveCell(cb: (cell: ActiveCell) => void): () => void;
  write(plan: WritePlan): Promise<WriteResult>;
  /** The host's own light/dark theme, when it has one (Excel). Overrides TavolioApp's `theme` prop. */
  theme?(): HostTheme | null;
  /** Subscribe to host theme changes. Returns an unsubscribe function. */
  watchTheme?(cb: (theme: HostTheme) => void): () => void;
}

export type HostTheme = "light" | "dark";
