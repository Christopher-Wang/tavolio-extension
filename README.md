# Tavolio

Local-first tabular prediction for spreadsheets. Principle: **the spreadsheet
host is a shell; the tabular engine is the product.** Google Sheets-specific
code stays thin so Excel (or any host) can reuse the same packages later.

## Layout

```text
apps/google-sheets/   thin shell: SheetsBridge (google.script.run) + Code.gs
packages/ui/           the whole sidebar UI, host-agnostic (HostBridge), + dev playground
packages/table/        canonical Table representation
packages/preprocessing/ spreadsheet intelligence (type inference, missing values)
packages/models/       TavolioModel contract + local-tabular adapter
packages/runtime/      Runtime interface (Onyx/WebGPU isolated here)
packages/prediction/   predictTable: schema -> task -> prepare/run/decode
tests/                 fixtures (churn/housing/messy) + integration pipeline test
```

## Prereqs

- A container runtime: Docker (or Podman — replace `docker` with `podman`
  and `docker compose` with `podman compose`).
- No local Node/npm needed. Everything runs in `node:22-alpine`.

## Commands (all containerized)

```sh
# install deps
docker compose run --rm base npm install

# build all packages + the UI (apps/google-sheets/dist)
docker compose run --rm base npm run build

# typecheck everything
docker compose run --rm typecheck

# run integration tests (churn/housing/messy fixtures)
docker compose run --rm test

# playground: mock spreadsheet + real sidebar (https://localhost:3000, see below)
docker compose up app
```

## Run locally over HTTPS (Excel + Sheets)

Excel task panes and the Sheets iframe both need HTTPS. `make dev` serves the UI
(hot reload) at `https://localhost:3000`; UI changes never need re-installing.

```sh
make certs     # one-time: local CA + localhost cert -> .docker/certs (gitignored)
make install   # one-time
make dev       # https://localhost:3000
```

Trust `.docker/certs/rootCA.pem` once, or the browser refuses the page:

- macOS/Chrome/Safari: open the file, add to Keychain (System), set "Always Trust".
- Firefox: Settings -> Privacy & Security -> View Certificates -> Authorities ->
  Import, tick "Trust this CA to identify websites". (Or set
  `security.enterprise_roots.enabled` to true in about:config to use the Keychain.)

Opening `https://localhost:3000` in a plain tab shows the mock spreadsheet.

### Excel (web)

Insert -> Add-ins -> Manage My Add-ins -> Upload My Add-in ->
`apps/excel/manifest.local.xml` (dev server) or `apps/excel/manifest.xml` (GitHub Pages).
Re-upload only if the manifest itself changes.

### Google Sheets

Extensions -> Apps Script. Paste the three files from `apps/google-sheets/appsscript/`
(`Code.gs`, `Shell.html`, `appsscript.json`), reload the sheet, then use
**Tavolio -> Open Tavolio (local https)** or **(hosted)**. The sidebar is an iframe of the
UI URL, so only edits to those three files ever need re-pasting: `Code.gs` (sheet
read/write functions), `Shell.html` (message relay + iframe `allow`), `appsscript.json` (scopes).
**Device check (local https)** runs `public/probe.html` inside that iframe (WebGPU / workers /
isolation / storage / fetch).

## Hosts

The UI talks to the spreadsheet only through `HostBridge`
(`packages/ui/src/host.ts`): `readTable`, `selectColumn`, `watchActiveCell`,
`write`. Sheets implements it in `apps/google-sheets/src/sheetsBridge.ts`
(selection is polled; Sheets has no sidebar selection events). An Excel
task pane only needs the same ~100-line bridge over Office.js.

`npm run build` at the root builds workspaces in dependency order
(table -> preprocessing/runtime -> models -> prediction -> tests -> sheets).

## MVP flow

```text
Sheets selection -> Table -> inferSchema -> inferTask
  -> adapter.prepare -> runtime.run -> adapter.decode -> PredictionResult
  -> write predictions column
```

1. Select table 2. Inspect detected column types 3. Select target
4. Predict 5. Write results. Single task concept
(`classification { classes } | regression`); the adapter owns the differences.

## Status / next steps

- `local-tabular-v1` is a transparent kNN baseline (k=3 over the encoded
  matrix) behind the real `TavolioModel` contract so the loop works
  end-to-end. It reports held-out accuracy/MAE vs the dumb baseline
  (majority class / mean target), per-row confidences, blank-target row
  indexes, and single-feature signal ranking — the sidebar renders
  "Prediction quality", "Most useful signals", and "Predict these N rows"
  directly from that.
- `profileColumns()` in `packages/preprocessing` explains IDs / free text /
  missingness in plain language ("Tavolio will handle them"); the encoder
  enforces the same ignore rules so UI copy and model behavior agree.
- `PredictError` in `packages/prediction` carries consumer titles
  ("Not enough examples yet", "This column can't be predicted yet") with
  per-class counts; the sidebar renders those instead of ML jargon.
- Next: land a real ONNX artifact + wire `OnyxRuntime` in `packages/runtime`
  (the only place ONNX/WebGPU code should live), then swap `LocalTabularModel.run()`.
- No backend/auth/billing yet — intentionally, until the local loop is excellent.
