/**
 * Thin Apps Script shell: table in, predictions out. No ML logic here.
 * The client half is apps/google-sheets/src/sheetsBridge.ts (HostBridge).
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Tavolio")
    .addItem("Open Tavolio", "openTavolio")
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

// Where the UI bundle is served from: `make serve` locally, our backend in production.
const TAVOLIO_URL = "https://localhost:3000/";

/**
 * The UI script runs in the sidebar document itself (Loader.html), so it calls the functions
 * below directly through google.script.run. Client half: apps/google-sheets/src/sheetsBridge.ts.
 */
function openTavolio() {
  const t = HtmlService.createTemplateFromFile("Loader");
  t.script = TAVOLIO_URL + "assets/app.js";
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

/** Polled by the sidebar (~1/s) so clicking a column (or, on the results screen, a row) in the grid can drive the UI. */
function tavolioActiveCell() {
  const cell = SpreadsheetApp.getCurrentCell();
  if (!cell) return null;
  return { sheetName: cell.getSheet().getName(), column: cell.getColumn(), row: cell.getRow() };
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

// ---- Prior Labs API (TabPFN) -----------------------------------------------
// Client half: packages/models/src/tabpfn/api.ts (HostedTransport, ApiKeyStore). api.priorlabs.ai only allows its own web
// origins, so the sidebar can't call it; these functions do, and hold each user's own key (never sent back to the page).

const PRIORLABS_API = "https://api.priorlabs.ai";
const API_KEY_PROPERTY = "PRIORLABS_API_KEY";

function tavolioApiKeySet() {
  return !!PropertiesService.getUserProperties().getProperty(API_KEY_PROPERTY);
}

function tavolioApiKeySave(key) {
  const trimmed = String(key || "").trim();
  if (!trimmed) throw new Error("Enter an API key");
  PropertiesService.getUserProperties().setProperty(API_KEY_PROPERTY, trimmed);
}

function tavolioApiKeyClear() {
  PropertiesService.getUserProperties().deleteProperty(API_KEY_PROPERTY);
}

/** One JSON call to the API as this user. Returns { status, body } for any HTTP status; only a failure to reach the API throws. */
function tavolioApiRequest(method, path, body) {
  const key = PropertiesService.getUserProperties().getProperty(API_KEY_PROPERTY);
  if (!key) return { status: 401, body: { detail: "No API key" } };
  if (!/^\/tabpfn\/[a-z_]+$/.test(path)) throw new Error("Unexpected API path");
  const options = {
    method: method === "GET" ? "get" : "post",
    headers: { Authorization: "Bearer " + key },
    muteHttpExceptions: true,
  };
  if (method !== "GET") {
    options.contentType = "application/json";
    options.payload = JSON.stringify(body || {});
  }
  const res = UrlFetchApp.fetch(PRIORLABS_API + path, options);
  let parsed = null;
  try {
    parsed = JSON.parse(res.getContentText());
  } catch (e) {
    // Not JSON (a gateway error page): the status alone is reported.
  }
  return { status: res.getResponseCode(), body: parsed };
}

/** PUT a file to a signed upload URL. The key is not sent: the URL carries its own authorisation. */
function tavolioApiUpload(url, headers, body) {
  if (!/^https:\/\//.test(url)) throw new Error("Unexpected upload address");
  const options = { method: "put", headers: headers || {}, payload: body, muteHttpExceptions: true };
  Object.keys(options.headers).forEach(function (h) {
    const name = h.toLowerCase();
    // Content-Type is set through its own option; as a plain header it would be overridden.
    if (name === "content-type") options.contentType = options.headers[h];
    // UrlFetchApp sets these itself and throws "Attribute provided with invalid value: Header:Host" if given them.
    if (name === "content-type" || name === "host" || name === "content-length") delete options.headers[h];
  });
  return { status: UrlFetchApp.fetch(url, options).getResponseCode() };
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
  const headRange = sheet.getRange(t.row, t.column, 1, t.columns);
  const header = headRange.getValues()[0].map(String);
  const headNotes = headRange.getNotes()[0];
  let end = t.column + t.columns - 1;
  // Reuse a column only if Tavolio wrote it (its header note says so): a user's own column that happens to
  // share the name is never overwritten, a new column is inserted instead.
  const dests = plan.columns.map(function (col) {
    for (let i = 0; i < header.length; i++) {
      if (header[i] === col.header && isTavolioNote_(headNotes[i])) return t.column + i;
    }
    return -1;
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

function isTavolioNote_(note) {
  return /^(Added by Tavolio|How sure Tavolio)/.test(note || "");
}

/**
 * Writes only into cells that are empty and have no formula, one contiguous run at a time. Cells between
 * runs are never touched (rewriting them would re-parse text like "00123" or "1/2" into numbers and dates),
 * and a note a user left on an empty cell is kept.
 */
function fillBlanks_(plan) {
  const t = plan.table;
  const sheet = sheetByName_(t.sheetName);
  const range = sheet.getRange(t.row + 1, t.column + plan.targetOffset, t.rows, 1);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const notes = range.getNotes();
  const fill = [];
  for (let i = 0; i < t.rows; i++) {
    const v = plan.values[i];
    fill.push(v !== null && v !== undefined && values[i][0] === "" && formulas[i][0] === "");
  }
  let first = -1;
  let last = -1;
  let i = 0;
  while (i < t.rows) {
    if (!fill[i]) { i++; continue; }
    let j = i;
    while (j + 1 < t.rows && fill[j + 1]) j++;
    const run = sheet.getRange(t.row + 1 + i, t.column + plan.targetOffset, j - i + 1, 1);
    run.setValues(plan.values.slice(i, j + 1).map(function (v) { return [v]; }));
    run.setFontColor(FORECAST_COLOR);
    run.setNotes(plan.notes.slice(i, j + 1).map(function (n, k) { return [notes[i + k][0] || n || ""]; }));
    if (first === -1) first = i;
    last = j;
    i = j + 1;
  }
  if (first === -1) return { sheetName: sheet.getName(), address: "" };
  return { sheetName: sheet.getName(), address: sheet.getRange(t.row + 1 + first, t.column + plan.targetOffset, last - first + 1, 1).getA1Notation() };
}

/** Tavolio green (the pane's accent): forecasted values are written in it so they stand out from the user's data. */
const FORECAST_COLOR = "#0b7a5c";

function writeColumn_(sheet, headerRow, column, col) {
  const head = sheet.getRange(headerRow, column);
  head.setValue(col.header).setNote(col.note).setFontWeight("bold");
  if (col.values.length === 0) return;
  const body = sheet.getRange(headerRow + 1, column, col.values.length, 1);
  body.setValues(col.values.map(function (v) { return [v === null ? "" : v]; }));
  body.setFontColor(FORECAST_COLOR);
  if (col.format === "percent") body.setNumberFormat("0%");
}

function sheetByName_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" no longer exists');
  return sheet;
}
