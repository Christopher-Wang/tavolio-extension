# Tavolio

Local-first tabular prediction for spreadsheets. Principle: **the spreadsheet
host is a shell; the tabular engine is the product.** Google Sheets-specific
code stays thin so Excel (or any host) can reuse the same packages later.

## Layout

```text
apps/google-sheets/   boring shell: selection -> Table -> predictTable -> write back
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

# build all packages + tests + sidebar
docker compose run --rm base npm run build

# typecheck everything
docker compose run --rm typecheck

# run integration tests (churn/housing/messy fixtures)
docker compose run --rm test

# dev sidebar with sample data (http://localhost:5173)
docker compose up app
```

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

- `local-tabular-v1` is a transparent baseline (majority-class / mean-target)
  behind the real `TavolioModel` contract so the loop works end-to-end.
- Next: land a real ONNX artifact + wire `OnyxRuntime` in `packages/runtime`
  (the only place ONNX/WebGPU code should live), then swap `LocalTabularModel.run()`.
- No backend/auth/billing yet — intentionally, until the local loop is excellent.
