import { HostError, NO_TABLE_MESSAGE, type ActiveCell, type HostBridge, type SheetTable, type TableRef, type WritePlan, type WriteResult } from "../host.js";

/** 1-based rectangle. */
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface DevState {
  sheets: Map<string, unknown[][]>;
  active: string;
  cell: { row: number; column: number };
  selection: Rect | null;
  notes: Map<string, string>;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

export function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function a1(r: Rect): string {
  return `${columnLetter(r.left)}${r.top}:${columnLetter(r.right)}${r.bottom}`;
}

/**
 * In-memory spreadsheet that behaves like the real hosts: data-region
 * detection, native selection events, nondestructive writes. Drives the
 * browser playground (`docker compose up app`).
 */
export class DevBridge implements HostBridge {
  readonly kind = "dev" as const;
  readonly selectionEvents = "native" as const;
  private listeners = new Set<(c: ActiveCell) => void>();
  private viewListeners = new Set<() => void>();
  state: DevState;

  constructor(grid: unknown[][]) {
    this.state = {
      sheets: new Map([["Leads", grid]]),
      active: "Leads",
      cell: { row: 2, column: 2 },
      selection: null,
      notes: new Map(),
    };
  }

  // ---- Playground (MockSheet) side -------------------------------------
  subscribeView(fn: () => void): () => void {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  }
  private changed(): void {
    for (const fn of this.viewListeners) fn();
  }
  grid(name = this.state.active): unknown[][] {
    return this.state.sheets.get(name)!;
  }
  clickCell(row: number, column: number): void {
    this.state.cell = { row, column };
    this.state.selection = null;
    this.changed();
    for (const fn of this.listeners) fn({ sheetName: this.state.active, column });
  }
  clickColumnHeader(column: number): void {
    const g = this.grid();
    this.state.cell = { row: 1, column };
    this.state.selection = { top: 1, left: column, bottom: g.length, right: column };
    this.changed();
    for (const fn of this.listeners) fn({ sheetName: this.state.active, column });
  }
  switchSheet(name: string): void {
    this.state.active = name;
    this.state.cell = { row: 1, column: 1 };
    this.state.selection = null;
    this.changed();
  }

  // ---- HostBridge ------------------------------------------------------
  async readTable(): Promise<SheetTable> {
    await delay(150);
    const g = this.grid();
    const r = this.dataRegion(this.state.cell.row, this.state.cell.column);
    if (!r || r.bottom - r.top < 1) {
      throw new HostError("no-table", NO_TABLE_MESSAGE);
    }
    const values = [];
    for (let row = r.top; row <= r.bottom; row++) {
      const line = [];
      for (let c = r.left; c <= r.right; c++) line.push(g[row - 1]?.[c - 1] ?? "");
      values.push(line);
    }
    return {
      sheetName: this.state.active,
      row: r.top,
      column: r.left,
      rows: r.bottom - r.top,
      columns: r.right - r.left + 1,
      address: a1(r),
      values,
    };
  }

  async selectColumn(t: TableRef, offset: number): Promise<void> {
    this.state.active = t.sheetName;
    this.state.cell = { row: t.row, column: t.column + offset };
    this.state.selection = { top: t.row, left: t.column + offset, bottom: t.row + t.rows, right: t.column + offset };
    this.changed();
  }

  async readSelectedRows(t: TableRef): Promise<number[]> {
    const sel = this.state.selection ?? { top: this.state.cell.row, bottom: this.state.cell.row, left: 1, right: 1 };
    if (this.state.active !== t.sheetName) return [];
    const rows: number[] = [];
    for (let r = Math.max(sel.top, t.row + 1); r <= Math.min(sel.bottom, t.row + t.rows); r++) rows.push(r - t.row - 1);
    return rows;
  }

  watchActiveCell(cb: (cell: ActiveCell) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async write(plan: WritePlan): Promise<WriteResult> {
    await delay(250);
    const t = plan.table;
    const g = this.grid(t.sheetName);
    if (plan.mode === "fill-blanks") {
      const c = t.column + plan.targetOffset;
      let first = 0;
      let last = 0;
      plan.values.forEach((v, i) => {
        const row = t.row + 1 + i;
        if (v === null || !isBlank(g[row - 1]![c - 1])) return;
        g[row - 1]![c - 1] = v;
        if (plan.notes[i]) this.state.notes.set(`${t.sheetName}!${row}:${c}`, plan.notes[i]!);
        first ||= row;
        last = row;
      });
      this.changed();
      return { sheetName: t.sheetName, address: first ? a1({ top: first, left: c, bottom: last, right: c }) : "" };
    }

    if (plan.mode === "new-sheet") {
      let name = plan.sheetName;
      for (let n = 2; this.state.sheets.has(name); n++) name = `${plan.sheetName} ${n}`;
      const copy = [];
      for (let r = 0; r <= t.rows; r++) {
        const src = g[t.row - 1 + r]!.slice(t.column - 1, t.column - 1 + t.columns);
        copy.push([...src, ...plan.columns.map((col) => (r === 0 ? col.header : fmt(col.values[r - 1], col.format)))]);
      }
      this.state.sheets.set(name, copy);
      this.state.active = name;
      this.changed();
      return { sheetName: name, address: a1({ top: 1, left: 1, bottom: copy.length, right: copy[0]!.length }) };
    }

    // new-columns: reuse Tavolio's own columns, otherwise insert right of the table.
    const header = g[t.row - 1]!.slice(t.column - 1, t.column - 1 + t.columns).map(String);
    let end = t.column + t.columns - 1;
    const dests = plan.columns.map((col) => {
      const i = header.indexOf(col.header);
      return i >= 0 ? t.column + i : -1;
    });
    dests.forEach((d, k) => {
      if (d !== -1) return;
      for (const row of g) row.splice(end, 0, "");
      end += 1;
      dests[k] = end;
    });
    plan.columns.forEach((col, k) => {
      const c = dests[k]!;
      g[t.row - 1]![c - 1] = col.header;
      this.state.notes.set(`${t.sheetName}!${t.row}:${c}`, col.note);
      col.values.forEach((v, i) => (g[t.row + i]![c - 1] = fmt(v, col.format)));
    });
    this.changed();
    return {
      sheetName: t.sheetName,
      address: a1({ top: t.row, left: Math.min(...dests), bottom: t.row + t.rows, right: Math.max(...dests) }),
    };
  }

  /** Like Sheets' getDataRegion / Excel's getSurroundingRegion. */
  private dataRegion(row: number, column: number): Rect | null {
    const g = this.grid();
    const at = (r: number, c: number) => !isBlank(g[r - 1]?.[c - 1]);
    if (!at(row, column)) return null;
    const r: Rect = { top: row, left: column, bottom: row, right: column };
    const rowHas = (y: number, x0: number, x1: number) => {
      for (let x = x0; x <= x1; x++) if (at(y, x)) return true;
      return false;
    };
    const colHas = (x: number, y0: number, y1: number) => {
      for (let y = y0; y <= y1; y++) if (at(y, x)) return true;
      return false;
    };
    for (let grew = true; grew; ) {
      grew = false;
      if (r.top > 1 && rowHas(r.top - 1, r.left - 1, r.right + 1)) (r.top--, (grew = true));
      if (rowHas(r.bottom + 1, r.left - 1, r.right + 1)) (r.bottom++, (grew = true));
      if (r.left > 1 && colHas(r.left - 1, r.top - 1, r.bottom + 1)) (r.left--, (grew = true));
      if (colHas(r.right + 1, r.top - 1, r.bottom + 1)) (r.right++, (grew = true));
    }
    return r;
  }
}

function fmt(v: string | number | null | undefined, format?: "percent"): unknown {
  if (v === null || v === undefined) return "";
  return format === "percent" && typeof v === "number" ? `${Math.round(v * 100)}%` : v;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
