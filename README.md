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
packages/models/       TavolioModel contract, local-tabular fallback, TabPFN client + approximate SHAP
packages/runtime/      Runtime interface (Onyx/WebGPU isolated here)
tools/tabpfn-export/   Docker pipeline: TabPFN checkpoint -> INT4 ONNX (MatMulNBits)
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
`apps/excel/manifest.local.xml` (dev server). A production manifest comes with the hosted backend.
Re-upload only if the manifest itself changes.

### Google Sheets

Extensions -> Apps Script. Paste the three files from `apps/google-sheets/appsscript/`
(`Code.gs`, `Loader.html`, `appsscript.json`), reload the sheet, then use
**Tavolio -> Open Tavolio**. The sidebar runs the UI bundle directly in its own document
(`Loader.html` loads `assets/app.js` from `TAVOLIO_URL` in `Code.gs`), so only edits to those
three files ever need re-pasting. `make serve` serves the watched build at https://localhost:3000
(stop `make dev` first, they share the port; there is no hot reload on this path).

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

## Local inference

Predictions run in the browser: no table data leaves the sidebar. The model is
**TabPFN-3.5-Fast** (a tabular foundation model: the labelled rows are the context, and
one forward pass predicts the blank rows, with no training step), shrunk to ~44 MB
(~60 MB for regression) so it can ship to a client and run on WebGPU.

```text
Table -> TS front-end (encode, ECDF)  -> ORT-web (WebGPU) -> logits -> probabilities / mean
         packages/models/src/tabpfn     packages/runtime      (+ approximate SHAP, see below)
```

### Model build (`tools/tabpfn-export`)

A Dockerised Python pipeline turns the PyTorch checkpoint into the client ONNX graph
(details and commands in [its README](tools/tabpfn-export/README.md)):

- **Export**: the graph starts after the model's data-dependent front-end, with
  opset-17 rewrites for the ops ONNX can't express. The front-end (NaN indicators,
  scaling, ECDF via sort/searchsorted) is ported to TypeScript and tested bit-exact
  against PyTorch fixtures.
- **Fused attention**: attention is swapped for `com.microsoft::MultiHeadAttention`.
- **INT4 quantization**: round-to-nearest, block size 128, written as ORT
  **`MatMulNBits`** nodes. 334 MB fp32 becomes ~44 MB. RTN was chosen over a k-means
  codebook because it needs only an affine dequant in the shader.
- **fp16 where it's safe**: a custom pass keeps the in-context-learning stack in fp16,
  and leaves attention, norm statistics and the cell embedder in fp32 (they overflow or
  lose precision in fp16). Graph is simplified before quantizing so every MatMul is hit.
- **Parity**: on ORT CPU the quantized model agrees with PyTorch on 99.3-100% of argmax
  predictions across iris/wine/breast_cancer/digits; `make test-model` re-checks the
  TypeScript front-end + `OnyxRuntime` + real model through `onnxruntime-node`.
- **Regression** is a second graph from the same checkpoint (5000-bucket bar-distribution
  head, kept fp32); the prediction is the softmax-weighted mean of fixed bucket means.

### Runtime

`packages/runtime` (`OnyxRuntime`) is the only place ONNX code lives, with the ORT build
injected: `onnxruntime-node` in tests, `onnxruntime-web/webgpu` in the Sheets sidebar
(`apps/google-sheets/src/tabpfn.ts`). The wasm and model files go through Cache Storage,
keyed by `MODEL_REV`, so they download once. `docker/serve-dist.mjs` serves them in dev.
`TabPfnModel` handles classification and regression and falls back to the plain
`local-tabular-v1` model (with a notice in the sidebar) when WebGPU/f16 is missing, there
are more than 64 classes, or the runtime errors.

### Approximate SHAP

Exact Shapley values need 2^features model calls. `packages/models/src/explain.ts` uses
only the cheap "identity" coalitions of Kernel SHAP: each feature alone against everything
else blank (NaN, which TabPFN handles natively). Rows sharing a value in a column share
the evaluation, so the cost is the number of distinct (column, value) pairs, not
rows x features. The solo effects are corrected so each row's values sum to
`prediction - baseline` exactly, with interactions split evenly. The sidebar shows these as
"Most useful signals" and a per-row waterfall (classification; regression gets the column
ranking only).

### Other models and caveats

- `local-tabular-v1` (kNN/ridge/logistic) is the reference model behind the same
  `TavolioModel` contract and the fallback above. It reports held-out accuracy/MAE vs a
  dumb baseline.
- `profileColumns()` explains IDs, free text and missingness in plain language;
  `PredictError` carries consumer-facing titles instead of ML jargon.
- **Licence**: the TabPFN-3.5 weights (and quantized derivatives) are research/internal
  use only; shipping needs a Prior Labs agreement. `tools/tabpfn-export/out/` is gitignored.
- Not ported: text columns and TabPFN's 4-estimator ensemble.
- No backend/auth/billing yet, intentionally, until the local loop is excellent.
