"""Expected class probabilities from the shipped client models (Python ORT + Python front-end): `probabilities` for the fp16 model,
`probabilitiesF32` for the fp32-activation one. For the Node and browser parity tests.
Writes /out/model-parity.json (derived from the model weights, so it stays in the gitignored out/ dir)."""
import json, numpy as np, torch, onnxruntime as ort
from sklearn.datasets import load_iris, load_breast_cancer, load_wine
from sklearn.model_selection import train_test_split
from wrapper import load_model, frontend

m = load_model()
so = ort.SessionOptions(); so.intra_op_num_threads = 4
sessions = {k: ort.InferenceSession(f"/out/{f}", so, providers=["CPUExecutionProvider"]) for k, f in (("probabilities", "tabpfn_fast_client.onnx"), ("probabilitiesF32", "tabpfn_fast_client_f32.onnx"))}
enc = lambda v: "NaN" if np.isnan(v) else float(v)
rng = np.random.default_rng(3)

def case(name, loader, nan_frac=0.0):
    X, y = loader(return_X_y=True)
    X = X.astype(np.float32)
    if nan_frac: X[rng.random(X.shape) < nan_frac] = np.nan
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0, stratify=y)
    n, k = len(Xtr), int(y.max()) + 1
    xs, nn_, ec = frontend(m, torch.tensor(np.concatenate([Xtr, Xte])).unsqueeze(1), n)
    feed = {"x": xs.numpy(), "nan_ind": nn_.numpy(), "ecdf": ec.numpy(), "y": ytr.astype(np.float32)[:, None]}
    probs = {}
    for key, sess in sessions.items():
        logits = sess.run(None, feed)[0][:, 0, :k]
        p = np.exp(logits - logits.max(1, keepdims=True)); p /= p.sum(1, keepdims=True)
        probs[key] = p.ravel().tolist()
    return {"name": name, "cols": X.shape[1], "numClasses": k, "nTrain": n, "nTest": len(Xte),
            "x": [enc(v) for v in np.concatenate([Xtr, Xte]).ravel()], "yTrain": ytr.tolist(), "yTest": yte.tolist(),
            **probs}

cases = [case("iris", load_iris), case("wine", load_wine), case("breast_cancer", load_breast_cancer),
         case("breast_cancer_5pct_nan", load_breast_cancer, nan_frac=0.05)]
json.dump(cases, open("/out/model-parity.json", "w"))
print("wrote", [(c["name"], c["nTest"]) for c in cases])
