import React from "react";
import { createRoot } from "react-dom/client";
import { TavolioApp } from "@tavolio/ui";
import { SheetsBridge, hasAppsScript } from "./sheetsBridge.js";

const root = createRoot(document.getElementById("root")!);

if (hasAppsScript()) {
  root.render(
    <React.StrictMode>
      <TavolioApp host={new SheetsBridge()} theme="light" />
    </React.StrictMode>,
  );
} else if (import.meta.env.DEV) {
  // Browser playground: mock spreadsheet + sidebar. Dev-only, tree-shaken from the Sheets bundle.
  void import("@tavolio/ui/dev").then(({ DevHarness }) =>
    root.render(
      <React.StrictMode>
        <DevHarness />
      </React.StrictMode>,
    ),
  );
} else {
  root.render(<p style={{ font: "13px system-ui", padding: 16 }}>Open Tavolio from the Extensions menu in Google Sheets.</p>);
}
