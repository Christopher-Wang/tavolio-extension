"""Real-data parity: PyTorch wrapper vs ONNX models in /out on sklearn datasets (single estimator, no ensembling). usage: eval_real.py [model.onnx ...]"""
import sys, numpy as np, torch, onnxruntime as ort
from sklearn.datasets import load_breast_cancer, load_wine, load_iris, load_digits
from sklearn.model_selection import train_test_split
from wrapper import ExportWrap, load_model, frontend
m = load_model(); w = ExportWrap(m).eval()
so = ort.SessionOptions(); so.intra_op_num_threads = 4
files = sys.argv[1:] or ["tabpfn_fast_fused_est1_fp32.onnx", "tabpfn_fast_client.onnx"]   # fp32 reference vs the shipped client model
sessions = {f.replace("tabpfn_fast_", "").replace(".onnx", ""): ort.InferenceSession(f"/out/{f}", so, providers=["CPUExecutionProvider"]) for f in files}
print(f"{'dataset':14s} {'n_tr':>5s} {'n_te':>5s} {'torch':>7s} " + " ".join(f"{n:>20s}" for n in sessions) + "   last agrees w/ torch")
for name, loader in [("iris", load_iris), ("wine", load_wine), ("breast_cancer", load_breast_cancer), ("digits", load_digits)]:
    X, y = loader(return_X_y=True)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0, stratify=y)
    N, K = len(Xtr), int(y.max()) + 1
    x = torch.tensor(np.concatenate([Xtr, Xte]), dtype=torch.float32).unsqueeze(1)   # (rows, est=1, cols)
    xs, nn_, ec = frontend(m, x, N); yy = torch.tensor(ytr, dtype=torch.float32).unsqueeze(1)
    with torch.no_grad(): ref = w(xs, nn_, ec, yy).numpy()[:, 0, :K]
    feed = {"x": xs.numpy(), "nan_ind": nn_.numpy(), "ecdf": ec.numpy(), "y": yy.numpy()}
    outs = {n: s.run(None, feed)[0][:, 0, :K] for n, s in sessions.items()}
    acc = lambda l: float((l.argmax(1) == yte).mean())
    print(f"{name:14s} {N:5d} {len(Xte):5d} {acc(ref):7.4f} " + " ".join(f"{acc(o):20.4f}" for o in outs.values())
          + f"   {float((outs[list(outs)[-1]].argmax(1) == ref.argmax(1)).mean()):.3f}")
