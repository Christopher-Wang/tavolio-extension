"""Reference fixtures for the TypeScript TabPFN front-end port (no model weights involved: pure deterministic preprocessing).
Writes tests/fixtures/tabpfn-frontend.json (mounted at /fixtures). Run: docker compose run --rm -e TABPFN_TOKEN export python make_fixtures.py"""
import json, numpy as np, torch
from wrapper import load_model, frontend

m = load_model()
rng = np.random.default_rng(7)
enc = lambda v: "NaN" if np.isnan(v) else ("Infinity" if v == np.inf else ("-Infinity" if v == -np.inf else float(v)))

def case(name, x, n_train, buckets=None):
    x = x.astype(np.float32)
    saved = m.ecdf_num_buckets
    if buckets: m.ecdf_num_buckets = buckets
    try:
        xs, nan, ec = frontend(m, torch.tensor(x).unsqueeze(1), n_train)       # (rows, 1, cols) -> (1, rows, cols)
    finally:
        m.ecdf_num_buckets = saved
    rows, cols = x.shape
    return {"name": name, "rows": rows, "cols": cols, "nTrain": n_train, "numBuckets": buckets or int(saved),
            "x": [enc(v) for v in x.ravel()],
            "scaled": xs[0].numpy().ravel().tolist(), "nanInd": nan[0].numpy().ravel().tolist(), "ecdf": ec[0].numpy().ravel().tolist()}

cases = [case("plain", rng.normal(size=(80, 5)), 60)]

x = np.zeros((200, 8), dtype=np.float32)
x[:, 0] = rng.normal(size=200); x[rng.choice(200, 25, replace=False), 0] = np.nan
x[:, 1] = rng.normal(size=200); x[[3, 50, 170], 1] = np.inf; x[[7, 90], 1] = -np.inf
x[:, 2] = 3.0
x[:, 3] = rng.integers(0, 5, 200)
x[:, 4] = rng.choice([0.1, 0.2], 200); x[[2, 160], 4] = np.nan
x[:150, 5] = rng.uniform(0, 1, 150); x[150:, 5] = rng.uniform(-5, 5, 50)
x[:150, 6] = np.nan; x[150:, 6] = rng.normal(size=50)
x[:, 7] = rng.normal(size=200) * 1e6
cases.append(case("nonfinite_ties_constant_outside", x, 150))

x = np.stack([rng.normal(size=120), rng.exponential(size=120), rng.integers(0, 10, 120).astype(float), rng.normal(size=120).round(1)], axis=1)
cases.append(case("buckets16", x, 100, buckets=16))
cases.append(case("single_train_row", rng.normal(size=(6, 3)), 1))

json.dump(cases, open("/fixtures/tabpfn-frontend.json", "w"))
print("wrote", len(cases), "cases;", sum(len(c["x"]) for c in cases), "input cells")
