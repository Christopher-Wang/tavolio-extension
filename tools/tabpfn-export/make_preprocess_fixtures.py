"""Reference fixtures for the TS port of TabPFN's table-level preprocessing (encode.ts / inputs.ts): the library's own modality
detector (with the 3.5 config values) and its TorchSoftClipOutliers. Writes tests/fixtures/tabpfn-preprocess.json (mounted at /fixtures).
Run: docker compose run --rm export python make_preprocess_fixtures.py   (no weights or token needed)"""
import json, numpy as np, torch
from tabpfn.preprocessing.modality_detection import detect_feature_modalities
from tabpfn.preprocessing.torch import TorchSoftClipOutliers

rng = np.random.default_rng(3)

def modality_case(n):
    cols = {
        "continuous": rng.normal(size=n),
        "three_levels": rng.integers(0, 3, n).astype(float),
        "four_levels": rng.integers(0, 4, n).astype(float),
        "two_plus_blank": np.where(rng.random(n) < 0.2, np.nan, rng.integers(0, 2, n).astype(float)),
        "three_plus_blank": np.where(rng.random(n) < 0.2, np.nan, rng.integers(0, 3, n).astype(float)),
        "constant": np.full(n, 7.0),
        "all_blank": np.full(n, np.nan),
        "one_value_plus_blank": np.where(rng.random(n) < 0.3, np.nan, 1.0),
    }
    cols["one_value_plus_blank"][0] = np.nan; cols["one_value_plus_blank"][1] = 1.0
    names = list(cols)
    X = np.stack([cols[k] for k in names], axis=1).astype(object)
    schema = detect_feature_modalities(
        X, names, min_samples_for_inference=100, max_unique_for_category=1_000_000,
        min_unique_for_numerical=4, min_cardinality_for_text=30)
    enc = lambda v: None if np.isnan(v) else float(v)
    return {"rows": n, "names": names,
            "columns": {k: [enc(v) for v in cols[k]] for k in names},
            "modality": {f.name.removeprefix("__input_feature_") if hasattr(f.name, "removeprefix") else f.name: f.modality.name for f in schema.features}}

def clip_case(name, x, n_train):
    x = x.astype(np.float32)
    out = TorchSoftClipOutliers(n_sigma=12.0)(torch.tensor(x), num_train_rows=n_train).numpy()
    enc = lambda v: "NaN" if np.isnan(v) else float(v)
    return {"name": name, "rows": x.shape[0], "cols": x.shape[1], "nTrain": n_train,
            "x": [enc(v) for v in x.ravel()], "clipped": [enc(v) for v in out.ravel()]}

n = 120
x = np.stack([rng.normal(size=n), rng.normal(size=n), rng.normal(size=n), rng.exponential(size=n)], axis=1)
x[5, 0] = 1e4; x[17, 1] = -3e3; x[100, 0] = 5e5          # train and test outliers
x[rng.choice(n, 10, replace=False), 2] = np.nan
x[3, 3] = 1e7
cases = [clip_case("outliers_and_blanks", x, 90), clip_case("single_train_row", rng.normal(size=(5, 2)), 1),
         clip_case("no_outliers", rng.normal(size=(50, 3)), 40)]

json.dump({"modality": [modality_case(60), modality_case(150)], "clip": cases}, open("/fixtures/tabpfn-preprocess.json", "w"))
print("wrote")
