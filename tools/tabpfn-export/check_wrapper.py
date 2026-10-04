import torch
from wrapper import ExportWrap, load_model, frontend
m = load_model(); w = ExportWrap(m).eval()
torch.manual_seed(0)
for R, B, C, N, K in [(80, 2, 5, 60, 3), (200, 1, 17, 150, 5), (50, 4, 3, 30, 2)]:
    x = torch.randn(R, B, C); x[3, 0, 1] = float("nan")   # include a NaN cell
    y = ((torch.arange(N)[:, None] + torch.arange(B)[None, :]) % K).float()
    with torch.no_grad():
        ref = m(x, y, "multiclass"); xs, nn_, ec = frontend(m, x, N); got = w(xs, nn_, ec, y)
    print((R, B, C, N, K), tuple(ref.shape), tuple(got.shape), "max|diff|", (ref - got).abs().max().item())
