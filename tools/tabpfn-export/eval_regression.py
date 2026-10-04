"""Regression parity: PyTorch wrapper vs the ONNX regression models, plus the bar-distribution mean vs TabPFNRegressor's own mean
(single-estimator reference path). usage: eval_regression.py"""
import sys, numpy as np, torch, onnxruntime as ort
from sklearn.datasets import load_diabetes, fetch_california_housing
from sklearn.model_selection import train_test_split
from wrapper import RegressionExportWrap, load_regressor, frontend
m = load_regressor(); w = RegressionExportWrap(m).eval()
so = ort.SessionOptions(); so.intra_op_num_threads = 4
files = sys.argv[1:] or ["tabpfn_fast_reg_fused_est1_fp32.onnx", "tabpfn_fast_reg_client_f32.onnx", "tabpfn_fast_reg_client.onnx"]
sessions = {f: ort.InferenceSession(f"/out/{f}", so, providers=["CPUExecutionProvider"]) for f in files}
borders = m.heads.regression_borders.double()
widths = borders[1:] - borders[:-1]
mid = borders[:-1] + widths / 2
def mean_of(logits):                                    # plain bucket-midpoint mean (tails refined in TS from bucketMeans)
    return (torch.softmax(torch.tensor(logits, dtype=torch.float64), -1) @ mid).numpy()
print(f"{'dataset':12s} {'ref R2':>8s} " + " ".join(f"{f[:24]:>26s}" for f in files))
for name, loader in [("diabetes", load_diabetes)]:
    X, y = loader(return_X_y=True)
    X, y = X[:400], y[:400]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)
    mu, sd = ytr.mean(), ytr.std() + 1e-20
    N = len(Xtr)
    x = torch.tensor(np.concatenate([Xtr, Xte]), dtype=torch.float32).unsqueeze(1)
    xs, nn_, ec = frontend(m, x, N); yy = torch.tensor((ytr - mu) / sd, dtype=torch.float32).unsqueeze(1)
    with torch.no_grad(): ref = w(xs, nn_, ec, yy).numpy()[:, 0, :]
    feed = {"x": xs.numpy(), "nan_ind": nn_.numpy(), "ecdf": ec.numpy(), "y": yy.numpy()}
    r2 = lambda p: 1 - ((yte - (p * sd + mu)) ** 2).sum() / ((yte - yte.mean()) ** 2).sum()
    pr = mean_of(ref)
    row = f"{name:12s} {r2(pr):8.4f} "
    for f, s in sessions.items():
        o = s.run(None, feed)[0][:, 0, :]
        po = mean_of(o)
        row += f"  R2 {r2(po):.4f} maxdz {np.abs(po - pr).max():.4f}"
    print(row)
