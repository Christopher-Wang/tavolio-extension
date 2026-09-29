import React from "react";
import { createRoot } from "react-dom/client";
import { TavolioApp, TavolioLoading, type HostBridge } from "@tavolio/ui";
import { ExcelBridge, loadOffice } from "./excelBridge.js";
import { isEmbeddedInSheetsShell, iframeCall } from "./iframeTransport.js";
import { SheetsBridge, hasAppsScript } from "./sheetsBridge.js";

/**
 * One UI, three ways in:
 *  - inlined in the Sheets sidebar (google.script.run),
 *  - hosted, in an iframe of the Sheets shell (?host=sheets, postMessage),
 *  - hosted, as the Excel task pane (Office.js).
 */
async function pickHost(): Promise<HostBridge | null> {
  if (hasAppsScript()) return new SheetsBridge();
  if (isEmbeddedInSheetsShell()) return new SheetsBridge(iframeCall);
  // Browser playground (`docker compose up app`): mock spreadsheet. Add ?host=excel to test in Excel.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("host") !== "excel") return null;
  return (await loadOffice()) ? new ExcelBridge() : null;
}

const root = createRoot(document.getElementById("root")!);
root.render(<TavolioLoading />);

void pickHost().then((host) => {
  if (host) {
    root.render(
      <React.StrictMode>
        <TavolioApp host={host} theme="light" />
      </React.StrictMode>,
    );
  } else if (import.meta.env.DEV) {
    // Dev-only, tree-shaken from production bundles.
    void import("@tavolio/ui/dev").then(({ DevHarness }) =>
      root.render(
        <React.StrictMode>
          <DevHarness />
        </React.StrictMode>,
      ),
    );
  } else {
    root.render(
      <p style={{ font: "13px system-ui", padding: 16 }}>
        Open Tavolio from the Extensions menu in Google Sheets, or the Tavolio button on the Home tab in Excel.
      </p>,
    );
  }
});
