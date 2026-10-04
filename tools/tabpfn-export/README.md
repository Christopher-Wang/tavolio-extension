# TabPFN-3.5-Fast → client model

Builds the ONNX model Tavolio runs locally: `out/tabpfn_fast_client.onnx` (+ `.onnx.data`, ~44 MB) from the public
`Prior-Labs/tabpfn_3_5` Fast checkpoint. One estimator, fused attention, INT4 RTN (block 128) weights, fp16 ICL stack.

Everything runs in Docker (CPU torch + onnxruntime); nothing is installed on the host.

```sh
export TABPFN_TOKEN=...   # Prior Labs API key whose account accepted the TabPFN-3.5 licence (ux.priorlabs.ai)
docker compose run --rm -e TABPFN_TOKEN export sh build_model.sh          # ~8 min; prints a parity table at the end
docker compose run --rm -e TABPFN_TOKEN export python check_wrapper.py    # wrapper == original model.forward (run after upgrading tabpfn)
docker compose run --rm -e TABPFN_TOKEN export python make_fixtures.py    # regenerate tests/fixtures/tabpfn-frontend.json
docker compose run --rm -e TABPFN_TOKEN export python make_parity_fixtures.py   # expected probabilities for `make test-model` (out/, gitignored)
```

Then `make test-model` (repo root) runs the TypeScript front-end + `OnyxRuntime` + this model through `onnxruntime-node` and compares with Python.

## Regression
Same checkpoint, separate graph (regression y-encoders and a 5000-bucket bar-distribution head): `docker compose run --rm -e TABPFN_TOKEN export sh build_regression.sh`
builds `out/tabpfn_fast_reg_client{,_f32}.onnx` (~60 MB, the head isn't INT4-quantized) and prints a parity check (`eval_regression.py`).
Inputs as above but `y` is the z-scored target; output `logits` `(n_test, 1, 5000)`. The TypeScript side (`tabpfn/regressor.ts`) z-scores the
target, softmaxes, and takes the mean with the fixed per-bucket means in `bucketMeans.ts` (`make_bucket_means.py`). Node parity fixtures:
`make_regression_parity.py` -> `out/model-parity-reg.json`. Single estimator, no target power transform (the 4-estimator ensemble isn't ported).

## Pipeline (`build_model.sh`)
| Step | Script | Why |
|---|---|---|
| export | `export_onnx.py`, `wrapper.py`, `fused.py` | Graph starts after the model's front-end; attention swapped for `com.microsoft::MultiHeadAttention`; opset-17 rewrites |
| simplify | `simplify_onnx.py` | Folds shape plumbing and the exporter's `Identity`-wrapped weights (needed for full quantization) |
| inline If | `inline_if.py` | Two rank-check `If` nodes always take the Squeeze branch |
| quantize | `quantize_onnx.py` | INT4 RTN → `MatMulNBits` |
| fp16 | `fp16_region.py` | fp16 only for the ICL stack; attention, norm statistics and the cell embedder stay fp32 |

## Interface
Inputs `x`, `nan_ind`, `ecdf` of shape `(1, rows, cols)` (train rows first) and `y` `(n_train, 1)` class ids `< 64`;
output `logits` `(n_test, 1, 160)`. The three feature tensors come from the model's data-dependent front-end, which needs
sort/searchsorted and so lives in TypeScript: `packages/models/src/tabpfn/frontend.ts` (`wrapper.frontend()` is the Python reference).

## Licence
The weights are under `tabpfn-3-5-license-v1.0`: research / internal evaluation only; the model, derivatives (including these
quantized files) and outputs may not be used commercially or in production without a Prior Labs agreement. `out/` and `.cache/`
are gitignored for that reason.
