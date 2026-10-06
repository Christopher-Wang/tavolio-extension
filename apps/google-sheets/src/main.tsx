import React from "react";
import { createRoot } from "react-dom/client";
import { TavolioApp, TavolioLoading, type HostBridge } from "@tavolio/ui";
import { ExcelBridge, loadOffice } from "./excelBridge.js";
import { SheetsBridge, hasAppsScript } from "./sheetsBridge.js";
import { registerTabPfn, warmTabPfn } from "./tabpfn.js";
import { registerTabPfnApi } from "./tabpfnApi.js";

/**
 * One UI, two ways in:
 *  - the Sheets sidebar, where Loader.html runs this bundle directly (google.script.run),
 *  - the Excel task pane (Office.js).
 */
async function pickHost(): Promise<HostBridge | null> {
  if (hasAppsScript()) return new SheetsBridge();
  // Browser playground (`npm run dev` in apps/google-sheets): mock spreadsheet. Add ?host=excel to test in Excel.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("host") !== "excel") return null;
  return (await loadOffice()) ? new ExcelBridge() : null;
}

const root = createRoot(document.getElementById("root")!);
// Sheets and Excel both title the pane themselves, so neither shows our own brand row (the dev playground does).
root.render(<TavolioLoading brand={false} />);

void pickHost().then((host) => {
  if (host) {
    // TabPFN runs on WebGPU in both hosts; without WebGPU it falls back to the built-in baseline.
    const modelId = registerTabPfn();
    warmTabPfn();
    // The API is a second choice in the Predict tab (the user's own Prior Labs key): held by Apps Script in Sheets, by the pane in Excel.
    const remote = registerTabPfnApi(host.kind === "sheets" ? "apps-script" : "browser");
    root.render(
      <React.StrictMode>
        <TavolioApp host={host} theme="light" brand={false} modelId={modelId} remote={remote} />
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
