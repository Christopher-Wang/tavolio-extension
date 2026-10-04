"""Expected regression predictions from the shipped client models (Python ORT + Python front-end + TabPFN's own bar-distribution mean):
`means` for the fp16 model, `meansF32` for the fp32-activation one, in the target's units. For the Node parity test.
Writes /out/model-parity-reg.json (derived from the weights, so it stays in the gitignored out/ dir)."""
import json, numpy as np, torch, onnxruntime as ort
from sklearn.datasets import load_diabetes
from sklearn.model_selection import train_test_split
from tabpfn.architectures.shared.bar_distribution import FullSupportBarDistribution
from wrapper import load_regressor, frontend

m = load_regressor()
dist = FullSupportBarDistribution(m.heads.regression_borders.float())
so = ort.SessionOptions(); so.intra_op_num_threads = 4
sessions = {k: ort.InferenceSession(f"/out/{f}", so, providers=["CPUExecutionProvider"]) for k, f in (("means", "tabpfn_fast_reg_client.onnx"), ("meansF32", "tabpfn_fast_reg_client_f32.onnx"))}
enc = lambda v: "NaN" if np.isnan(v) else float(v)
rng = np.random.default_rng(3)

def case(name, X, y, nan_frac=0.0):
    X = X.astype(np.float32)
    if nan_frac: X[rng.random(X.shape) < nan_frac] = np.nan
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)
    n = len(Xtr)
    mu, sd = float(ytr.mean()), float(ytr.std()) + 1e-20
    xs, nn_, ec = frontend(m, torch.tensor(np.concatenate([Xtr, Xte])).unsqueeze(1), n)
    feed = {"x": xs.numpy(), "nan_ind": nn_.numpy(), "ecdf": ec.numpy(), "y": ((ytr - mu) / sd).astype(np.float32)[:, None]}
    out = {k: (dist.mean(torch.tensor(s.run(None, feed)[0][:, 0, :])).numpy() * sd + mu).tolist() for k, s in sessions.items()}
    return {"name": name, "cols": X.shape[1], "nTrain": n, "nTest": len(Xte), "x": [enc(v) for v in np.concatenate([Xtr, Xte]).ravel()],
            "yTrain": ytr.tolist(), "yTest": yte.tolist(), **out}

Xd, yd = load_diabetes(return_X_y=True)
Xs = rng.normal(size=(300, 4)); ys = 3 * Xs[:, 0] + np.sin(2 * Xs[:, 1]) * 2 + 1000
cases = [case("diabetes", Xd[:400], yd[:400]), case("diabetes_5pct_nan", Xd[:400], yd[:400], 0.05), case("synthetic_offset", Xs, ys)]
json.dump(cases, open("/out/model-parity-reg.json", "w"))
print("wrote", [(c["name"], c["nTest"]) for c in cases])
