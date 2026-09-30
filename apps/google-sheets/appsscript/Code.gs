/**
 * Thin Apps Script shell: table in, predictions out. No ML logic here.
 * The client half is apps/google-sheets/src/sheetsBridge.ts (HostBridge).
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Tavolio")
    .addItem("Open Tavolio (hosted)", "showHostedSidebar")
    .addItem("Open Tavolio (local https)", "showLocalSidebar")
    .addSeparator()
    .addItem("Device check (local https)", "showLocalProbe")
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

// The hosted build (GitHub Pages) is the same UI Excel loads. It runs in an iframe here and
// reaches the sheet through Shell.html's postMessage relay.
const TAVOLIO_HOSTED_URL = "https://christopher-wang.github.io/tavolio/";

const TAVOLIO_LOCAL_URL = "https://localhost:3000/";

function showHostedSidebar() {
  showShell_(TAVOLIO_HOSTED_URL);
}

/** Same UI served by `make dev` on this machine. */
function showLocalSidebar() {
  showShell_(TAVOLIO_LOCAL_URL);
}

/** Same probe, but inside the Shell iframe like the real UI (served from public/probe.html). */
function showLocalProbe() {
  showShell_(TAVOLIO_LOCAL_URL, "probe.html");
}

function showShell_(baseUrl, path) {
  const t = HtmlService.createTemplateFromFile("Shell");
  t.url = path ? baseUrl + path : baseUrl + "?host=sheets";
  t.origin = baseUrl.replace(/^(https:\/\/[^\/]+).*$/, "$1");
  SpreadsheetApp.getUi().showSidebar(t.evaluate().setTitle("Tavolio"));
}

// ---- HostBridge: read ------------------------------------------------------

/**
 * The table around the user's selection. A single cell, row, or column
 * expands to the surrounding data region, so "click anywhere in the table"
 * just works. Returns only JSON-safe values: google.script.run turns a
 * response containing Date objects into null.
 */
function tavolioReadTable() {
  const sheet = SpreadsheetApp.getActiveSheet();
  let range = SpreadsheetApp.getActiveRange();
  if (!range) throw new Error("TAVOLIO_NO_TABLE");
  if (range.getNumRows() < 2 || range.getNumColumns() < 2) range = range.getDataRegion();
  // Whole-column selections run to the bottom of the grid; trim to real data.
  const lastRow = Math.min(range.getLastRow(), sheet.getLastRow());
  if (lastRow - range.getRow() < 1) throw new Error("TAVOLIO_NO_TABLE");
  range = sheet.getRange(range.getRow(), range.getColumn(), lastRow - range.getRow() + 1, range.getNumColumns());

  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const values = range.getValues().map(function (row) {
    return row.map(function (v) {
      if (v instanceof Date) {
        const hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
        return Utilities.formatDate(v, tz, hasTime ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyy-MM-dd");
      }
      return v;
    });
  });
  const blank = values[0].every(function (h) { return h === ""; });
  if (blank) throw new Error("TAVOLIO_NO_TABLE");

  return {
    sheetName: sheet.getName(),
    row: range.getRow(),
    column: range.getColumn(),
    rows: range.getNumRows() - 1,
    columns: range.getNumColumns(),
    address: range.getA1Notation(),
    values: values,
  };
}

/** Polled by the sidebar (~1/s) so clicking a column in the grid can drive the UI. */
function tavolioActiveCell() {
  const cell = SpreadsheetApp.getCurrentCell();
  if (!cell) return null;
  return { sheetName: cell.getSheet().getName(), column: cell.getColumn() };
}

/** 0-based data-row indexes of the table covered by the current selection (all ranges, header excluded). */
function tavolioSelectedRows(table) {
  if (SpreadsheetApp.getActiveSheet().getName() !== table.sheetName) return [];
  const list = SpreadsheetApp.getActiveRangeList();
  if (!list) return [];
  const seen = {};
  const rows = [];
  list.getRanges().forEach(function (range) {
    const first = Math.max(range.getRow(), table.row + 1);
    const last = Math.min(range.getLastRow(), table.row + table.rows);
    for (let r = first; r <= last; r++) {
      if (!seen[r]) { seen[r] = true; rows.push(r - table.row - 1); }
    }
  });
  return rows.sort(function (a, b) { return a - b; });
}

/** Highlight one table column (header + data). */
function tavolioSelectColumn(table, offset) {
  const sheet = sheetByName_(table.sheetName);
  sheet.getRange(table.row, table.column + offset, table.rows + 1, 1).activate();
}

// ---- HostBridge: write -----------------------------------------------------

/**
 * Nondestructive write-back (§7, §8). See WritePlan in packages/ui/src/host.ts.
 *  - new-columns: reuse Tavolio's own columns if present, else INSERT columns
 *    right of the table (never overwrites neighbouring data).
 *  - new-sheet:   copy of the table + prediction columns on a fresh sheet.
 *  - fill-blanks: only cells that are empty and have no formula.
 */
function tavolioWrite(plan) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    if (plan.mode === "fill-blanks") return fillBlanks_(plan);
    if (plan.mode === "new-sheet") return newSheet_(plan);
    return newColumns_(plan);
  } finally {
    lock.releaseLock();
  }
}

function newColumns_(plan) {
  const t = plan.table;
  const sheet = sheetByName_(t.sheetName);
  const header = sheet.getRange(t.row, t.column, 1, t.columns).getValues()[0].map(String);
  let end = t.column + t.columns - 1;
  const dests = plan.columns.map(function (col) {
    const i = header.indexOf(col.header);
    return i >= 0 ? t.column + i : -1;
  });
  for (let k = 0; k < dests.length; k++) {
    if (dests[k] !== -1) continue;
    sheet.insertColumnAfter(end);
    end += 1;
    dests[k] = end;
  }
  plan.columns.forEach(function (col, k) {
    writeColumn_(sheet, t.row, dests[k], col);
  });
  const left = Math.min.apply(null, dests);
  const right = Math.max.apply(null, dests);
  return { sheetName: sheet.getName(), address: sheet.getRange(t.row, left, t.rows + 1, right - left + 1).getA1Notation() };
}

function newSheet_(plan) {
  const t = plan.table;
  const src = sheetByName_(t.sheetName);
  const ss = SpreadsheetApp.getActive();
  let name = plan.sheetName;
  for (let n = 2; ss.getSheetByName(name); n++) name = plan.sheetName + " " + n;
  const sheet = ss.insertSheet(name);
  const width = t.columns + plan.columns.length;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  // Values + formats only: relative formulas would point at the wrong cells here.
  const source = src.getRange(t.row, t.column, t.rows + 1, t.columns);
  source.copyTo(sheet.getRange(1, 1), SpreadsheetApp.CopyPasteType.PASTE_VALUES, false);
  source.copyTo(sheet.getRange(1, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  plan.columns.forEach(function (col, k) {
    writeColumn_(sheet, 1, t.columns + 1 + k, col);
  });
  sheet.setFrozenRows(1);
  return { sheetName: name, address: sheet.getRange(1, 1, t.rows + 1, width).getA1Notation() };
}

function fillBlanks_(plan) {
  const t = plan.table;
  const sheet = sheetByName_(t.sheetName);
  const range = sheet.getRange(t.row + 1, t.column + plan.targetOffset, t.rows, 1);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const notes = range.getNotes();
  let first = -1;
  let last = -1;
  for (let i = 0; i < t.rows; i++) {
    const v = plan.values[i];
    if (v === null || v === undefined) continue;
    if (values[i][0] !== "" || formulas[i][0] !== "") continue;
    values[i][0] = v;
    if (plan.notes[i]) notes[i][0] = plan.notes[i];
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) return { sheetName: sheet.getName(), address: "" };
  // Write back only the changed span; keep existing formulas intact.
  const span = values.slice(first, last + 1).map(function (row, j) {
    const f = formulas[first + j][0];
    return [f !== "" ? f : row[0]];
  });
  const out = sheet.getRange(t.row + 1 + first, t.column + plan.targetOffset, last - first + 1, 1);
  out.setValues(span);
  out.setNotes(notes.slice(first, last + 1));
  return { sheetName: sheet.getName(), address: out.getA1Notation() };
}

function writeColumn_(sheet, headerRow, column, col) {
  const head = sheet.getRange(headerRow, column);
  head.setValue(col.header).setNote(col.note).setFontWeight("bold");
  if (col.values.length === 0) return;
  const body = sheet.getRange(headerRow + 1, column, col.values.length, 1);
  body.setValues(col.values.map(function (v) { return [v === null ? "" : v]; }));
  if (col.format === "percent") body.setNumberFormat("0%");
}

function sheetByName_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" no longer exists');
  return sheet;
}
