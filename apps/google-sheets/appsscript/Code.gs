/** Thin Apps Script shell: selection in, predictions out. No ML logic here. */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Tavolio")
    .addItem("Predict", "showSidebar")
    .addToUi();
}

function showSidebar() {
  // After `npm run build` in apps/google-sheets, paste dist/index.html content
  // into a Sidebar.html file, or serve it during development.
  const html = HtmlService.createHtmlOutputFromFile("Sidebar")
    .setTitle("Tavolio")
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Selected range -> { header, rows } for the sidebar Table conversion. */
function getSelectedTable() {
  const range = SpreadsheetApp.getActiveRange();
  if (!range) throw new Error("No range selected");
  const values = range.getValues();
  if (values.length < 2) throw new Error("Select a header row plus at least one data row");
  return values;
}

function writePredictions(payload) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const range = SpreadsheetApp.getActiveRange();
  if (!range || !sheet) throw new Error("No active range");
  const header = payload.header || "prediction";
  const startRow = range.getRow();
  const lastCol = range.getLastColumn();
  const destCol = lastCol + 1;
  const predictions = payload.predictions || [];
  sheet.getRange(startRow - 1, destCol).setValue(header);
  const out = predictions.map((p) => [p]);
  if (out.length > 0) {
    sheet.getRange(startRow, destCol, out.length, 1).setValues(out);
  }
}
