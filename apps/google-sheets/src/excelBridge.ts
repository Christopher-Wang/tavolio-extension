import { HostError, NO_TABLE_MESSAGE, type ActiveCell, type HostBridge, type HostTheme, type SheetTable, type TableRef, type WritePlan, type WriteResult, type PredictionColumn } from "@tavolio/ui";

/**
 * Excel implementation of HostBridge (Office.js). Same contract and write
 * semantics as sheetsBridge.ts + appsscript/Code.gs; selection events are
 * native here, so no polling.
 */

const OFFICE_JS = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
const READY_TIMEOUT_MS = 5000;

/** Loads office.js and resolves true only when running inside Excel. */
export function loadOffice(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    const s = document.createElement("script");
    s.src = OFFICE_JS;
    s.onload = () => void Office.onReady().then((info) => done(info.host === Office.HostType.Excel), () => done(false));
    s.onerror = () => done(false);
    document.head.appendChild(s);
  });
}

// ---- helpers ---------------------------------------------------------------

function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Excel reports dates as serial numbers; only the number format says which cells are dates. */
function isDateFormat(fmt: string): boolean {
  const f = fmt.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, "").toLowerCase();
  return /[ymdhs]/.test(f);
}

function serialToIso(serial: number): string {
  const days = Math.floor(serial);
  const secs = Math.round((serial - days) * 86400);
  const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000 + secs * 1000);
  const date = d.toISOString().slice(0, 10);
  return secs === 0 ? date : `${date}T${d.toISOString().slice(11, 19)}`;
}

/** A leading = + - @ would be parsed as a formula; an apostrophe forces text. */
function asLiteral(v: string | number): string | number {
  return typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v;
}

/** Office's theme colors are "#RRGGBB"; a dark pane background means a dark Office theme. */
function officeTheme(): HostTheme | null {
  const hex = Office.context.officeTheme?.bodyBackgroundColor;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const luma = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luma < 0.5 ? "dark" : "light";
}

function stripSheet(address: string): string {
  return address.slice(address.lastIndexOf("!") + 1);
}

async function getSheet(ctx: Excel.RequestContext, name: string): Promise<Excel.Worksheet> {
  const sheet = ctx.workbook.worksheets.getItemOrNullObject(name);
  sheet.load("isNullObject");
  await ctx.sync();
  if (sheet.isNullObject) throw new Error(`Sheet "${name}" no longer exists`);
  return sheet;
}

function writeColumn(sheet: Excel.Worksheet, headerRow: number, column: number, col: PredictionColumn): void {
  const head = sheet.getRangeByIndexes(headerRow - 1, column - 1, 1, 1);
  head.values = [[col.header]];
  head.format.font.bold = true;
  if (col.values.length === 0) return;
  const body = sheet.getRangeByIndexes(headerRow, column - 1, col.values.length, 1);
  // Inserted columns inherit their left neighbour's format (dates, currency...); reset it.
  const format = col.format === "percent" ? "0%" : "General";
  body.numberFormat = col.values.map(() => [format]);
  body.values = col.values.map((v) => [v === null ? "" : asLiteral(v)]);
}

interface NoteJob {
  sheetName: string;
  address: string;
  text: string;
}

/** Cell notes need ExcelApi 1.18; on older Excel the predictions are written without them. */
const MAX_NOTES = 500;
async function addNotes(jobs: NoteJob[]): Promise<void> {
  if (jobs.length === 0 || jobs.length > MAX_NOTES || !Office.context.requirements.isSetSupported("ExcelApi", "1.18")) return;
  try {
    await Excel.run(async (ctx) => {
      type Notes = {
        getItemOrNullObject(a: string): { isNullObject: boolean; delete(): void; load(p: string): void };
        add(a: string, text: string): void;
      };
      const existing = jobs.map((j) => {
        const notes = (ctx.workbook.worksheets.getItem(j.sheetName) as unknown as { notes: Notes }).notes;
        const item = notes.getItemOrNullObject(j.address);
        item.load("isNullObject");
        return { notes, item, j };
      });
      await ctx.sync();
      for (const { notes, item, j } of existing) {
        if (!item.isNullObject) item.delete();
        notes.add(j.address, j.text);
      }
      await ctx.sync();
    });
  } catch {
    // Notes are a nicety; never fail the write over them.
  }
}

// ---- bridge ----------------------------------------------------------------

export class ExcelBridge implements HostBridge {
  readonly kind = "excel" as const;
  readonly selectionEvents = "native" as const;

  /** Selecting a column ourselves fires a selection event; don't echo it back to the UI. */
  private own: { key: string; until: number } | null = null;

  async readTable(): Promise<SheetTable> {
    return Excel.run(async (ctx) => {
      const sel = ctx.workbook.getSelectedRange();
      sel.load(["rowCount", "columnCount"]);
      await ctx.sync();
      // A single cell, row, or column expands to the surrounding data region.
      const picked = sel.rowCount < 2 || sel.columnCount < 2 ? sel.getSurroundingRegion() : sel;
      // Whole-column selections run to the bottom of the grid; trim to real data.
      const used = picked.worksheet.getUsedRangeOrNullObject(true);
      used.load("isNullObject");
      await ctx.sync();
      if (used.isNullObject) throw noTable();
      const region = picked.getIntersectionOrNullObject(used);
      region.load(["isNullObject", "values", "numberFormat", "rowIndex", "columnIndex", "rowCount", "columnCount", "address"]);
      region.worksheet.load("name");
      await ctx.sync();
      if (region.isNullObject || region.rowCount < 2) throw noTable();

      const isDate = new Map<string, boolean>();
      const values = region.values.map((row, r) =>
        row.map((v, c) => {
          if (typeof v !== "number") return v;
          const fmt = region.numberFormat[r]![c] as string;
          let d = isDate.get(fmt);
          if (d === undefined) isDate.set(fmt, (d = isDateFormat(fmt)));
          return d ? serialToIso(v) : v;
        }),
      );
      if (values[0]!.every((h) => h === "")) throw noTable();

      return {
        sheetName: region.worksheet.name,
        row: region.rowIndex + 1,
        column: region.columnIndex + 1,
        rows: region.rowCount - 1,
        columns: region.columnCount,
        address: stripSheet(region.address),
        values,
      };
    });
  }

  async selectColumn(t: TableRef, offset: number): Promise<void> {
    this.own = { key: `${t.sheetName}:${t.column + offset}`, until: Date.now() + 1000 };
    await Excel.run(async (ctx) => {
      const sheet = await getSheet(ctx, t.sheetName);
      sheet.getRangeByIndexes(t.row - 1, t.column - 1 + offset, t.rows + 1, 1).select();
      await ctx.sync();
    });
  }

  async readSelectedRows(t: TableRef): Promise<number[]> {
    return Excel.run(async (ctx) => {
      const sel = ctx.workbook.getSelectedRange();
      sel.load(["rowIndex", "rowCount"]);
      sel.worksheet.load("name");
      await ctx.sync();
      if (sel.worksheet.name !== t.sheetName) return [];
      // Sheet rows (0-based) t.row..t.row+t.rows-1 are data; t.row - 1 is the header.
      const first = Math.max(sel.rowIndex, t.row);
      const last = Math.min(sel.rowIndex + sel.rowCount - 1, t.row + t.rows - 1);
      const rows: number[] = [];
      for (let r = first; r <= last; r++) rows.push(r - t.row);
      return rows;
    });
  }

  watchActiveCell(cb: (cell: ActiveCell) => void): () => void {
    let stopped = false;
    const handler = async () => {
      try {
        const cell = await Excel.run(async (ctx) => {
          const c = ctx.workbook.getSelectedRange().getCell(0, 0);
          c.load("columnIndex");
          c.worksheet.load("name");
          await ctx.sync();
          return { sheetName: c.worksheet.name, column: c.columnIndex + 1 };
        });
        if (stopped) return;
        if (this.own && this.own.key === `${cell.sheetName}:${cell.column}` && Date.now() < this.own.until) return;
        cb(cell);
      } catch {
        // Selection can be a chart or shape; ignore.
      }
    };
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler);
    return () => {
      stopped = true;
      Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, { handler });
    };
  }

  theme(): HostTheme | null {
    return officeTheme();
  }

  /** No dedicated event, so re-read when the pane regains focus (where a theme change is noticed). */
  watchTheme(cb: (theme: HostTheme) => void): () => void {
    const check = () => {
      const t = officeTheme();
      if (t) cb(t);
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }

  async write(plan: WritePlan): Promise<WriteResult> {
    if (plan.mode === "fill-blanks") return this.fillBlanks(plan);
    if (plan.mode === "new-sheet") return this.newSheet(plan);
    return this.newColumns(plan);
  }

  /** Reuse Tavolio's own columns if present, else insert columns right of the table. */
  private async newColumns(plan: Extract<WritePlan, { mode: "new-columns" }>): Promise<WriteResult> {
    const t = plan.table;
    const notes: NoteJob[] = [];
    const result = await Excel.run(async (ctx) => {
      const sheet = await getSheet(ctx, t.sheetName);
      const head = sheet.getRangeByIndexes(t.row - 1, t.column - 1, 1, t.columns);
      head.load("values");
      await ctx.sync();
      const header = head.values[0]!.map(String);
      let end = t.column + t.columns - 1;
      const dests = plan.columns.map((col) => {
        const i = header.indexOf(col.header);
        return i >= 0 ? t.column + i : -1;
      });
      dests.forEach((d, k) => {
        if (d !== -1) return;
        sheet.getRangeByIndexes(0, end, 1, 1).getEntireColumn().insert(Excel.InsertShiftDirection.right);
        end += 1;
        dests[k] = end;
      });
      plan.columns.forEach((col, k) => {
        writeColumn(sheet, t.row, dests[k]!, col);
        notes.push({ sheetName: t.sheetName, address: `${columnLetter(dests[k]!)}${t.row}`, text: col.note });
      });
      const left = Math.min(...dests);
      const out = sheet.getRangeByIndexes(t.row - 1, left - 1, t.rows + 1, Math.max(...dests) - left + 1);
      out.load("address");
      await ctx.sync();
      return { sheetName: t.sheetName, address: stripSheet(out.address) };
    });
    await addNotes(notes);
    return result;
  }

  private async newSheet(plan: Extract<WritePlan, { mode: "new-sheet" }>): Promise<WriteResult> {
    const t = plan.table;
    const width = t.columns + plan.columns.length;
    const notes: NoteJob[] = [];
    const result = await Excel.run(async (ctx) => {
      const src = await getSheet(ctx, t.sheetName);
      ctx.workbook.worksheets.load("items/name");
      await ctx.sync();
      const taken = new Set(ctx.workbook.worksheets.items.map((s) => s.name.toLowerCase()));
      // Sheet names: max 31 chars, none of \ / ? * [ ] :
      const base = plan.sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 28);
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
      const dst = ctx.workbook.worksheets.add(name);
      const from = src.getRangeByIndexes(t.row - 1, t.column - 1, t.rows + 1, t.columns);
      const to = dst.getRangeByIndexes(0, 0, t.rows + 1, t.columns);
      // Values + formats only: relative formulas would point at the wrong cells here.
      to.copyFrom(from, Excel.RangeCopyType.values);
      to.copyFrom(from, Excel.RangeCopyType.formats);
      plan.columns.forEach((col, k) => {
        writeColumn(dst, 1, t.columns + 1 + k, col);
        notes.push({ sheetName: name, address: `${columnLetter(t.columns + 1 + k)}1`, text: col.note });
      });
      dst.freezePanes.freezeRows(1);
      dst.activate();
      const out = dst.getRangeByIndexes(0, 0, t.rows + 1, width);
      out.load("address");
      await ctx.sync();
      return { sheetName: name, address: stripSheet(out.address) };
    });
    await addNotes(notes);
    return result;
  }

  /** Only cells that are empty and have no formula; never touches existing values. */
  private async fillBlanks(plan: Extract<WritePlan, { mode: "fill-blanks" }>): Promise<WriteResult> {
    const t = plan.table;
    const col = t.column + plan.targetOffset;
    const notes: NoteJob[] = [];
    const result = await Excel.run(async (ctx) => {
      const sheet = await getSheet(ctx, t.sheetName);
      const range = sheet.getRangeByIndexes(t.row, col - 1, t.rows, 1);
      range.load("formulas");
      await ctx.sync();
      const formulas = range.formulas;
      let first = -1;
      let last = -1;
      for (let i = 0; i < t.rows; i++) {
        const v = plan.values[i];
        if (v === null || v === undefined || formulas[i]![0] !== "") continue;
        formulas[i]![0] = asLiteral(v);
        const note = plan.notes[i];
        if (note) notes.push({ sheetName: t.sheetName, address: `${columnLetter(col)}${t.row + 1 + i}`, text: note });
        if (first === -1) first = i;
        last = i;
      }
      if (first === -1) return { sheetName: t.sheetName, address: "" };
      // Write back only the changed span; cells inside it that hold formulas keep them.
      const out = sheet.getRangeByIndexes(t.row + first, col - 1, last - first + 1, 1);
      out.formulas = formulas.slice(first, last + 1);
      out.load("address");
      await ctx.sync();
      return { sheetName: t.sheetName, address: stripSheet(out.address) };
    });
    await addNotes(notes);
    return result;
  }
}

function noTable(): HostError {
  return new HostError("no-table", NO_TABLE_MESSAGE);
}
