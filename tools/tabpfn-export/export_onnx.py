"""Export the post-front-end TabPFN-3.5-Fast graph to ONNX (legacy tracer, opset 17, fused attention, static single estimator).
inputs: x, nan_ind, ecdf (1, rows, cols); y (n_train, 1) -> logits (n_test, 1, 160)."""
import torch
import torch.nn.functional as F
import tabpfn.architectures.tabpfn_v3_5 as arch
import fused
import os
from wrapper import ExportWrap, RegressionExportWrap, load_model, load_regressor

REGRESSION = os.environ.get("TASK") == "regression"
OUT = "/out/tabpfn_fast_reg_fused_est1_fp32.onnx" if REGRESSION else "/out/tabpfn_fast_fused_est1_fp32.onnx"

# Rewrites for ops missing from ONNX opset 17, or exported in ways WebGPU can't run (same semantics). torch's isinf/isfinite/nan_to_num
# export as Cast(double) + IsInf, and WebGPU has no double type, so express them as plain comparisons.
def _isnan(t): return t != t
def _isinf(t): return (t == float("inf")) | (t == float("-inf"))
def _isfinite(t): return (t - t) == 0          # NaN and +-inf both give NaN, which is != 0
def _nan_to_num(t, nan=0.0, posinf=None, neginf=None):
    info = torch.finfo(t.dtype)
    out = torch.where(t != t, torch.full_like(t, nan), t)
    out = torch.where(out == float("inf"), torch.full_like(t, info.max if posinf is None else posinf), out)
    return torch.where(out == float("-inf"), torch.full_like(t, info.min if neginf is None else neginf), out)
for _name, _fn in (("isnan", _isnan), ("isinf", _isinf), ("isfinite", _isfinite), ("nan_to_num", _nan_to_num)):
    setattr(torch, _name, _fn)
    setattr(torch.Tensor, _name, lambda self, *a, _f=_fn, **k: _f(self, *a, **k))
torch.isposinf = lambda t: t == float("inf")
torch.isneginf = lambda t: t == float("-inf")
torch.Tensor.isposinf = lambda self: self == float("inf")
torch.Tensor.isneginf = lambda self: self == float("-inf")

def _nanmean(t, dim=None, keepdim=False, *, dtype=None):
    ok = ~torch.isnan(t)
    z = torch.where(ok, t, torch.zeros_like(t))
    if dim is None:
        return z.sum() / ok.sum().clamp_min(1)
    return z.sum(dim=dim, keepdim=keepdim) / ok.sum(dim=dim, keepdim=keepdim).clamp_min(1)

def _rms_norm(input, normalized_shape, weight=None, eps=None):
    eps = torch.finfo(input.dtype).eps if eps is None else eps
    dims = tuple(range(-len(normalized_shape), 0))
    y = input * torch.rsqrt(input.pow(2).mean(dim=dims, keepdim=True) + eps)
    return y * weight if weight is not None else y

torch.nn.functional.rms_norm = _rms_norm
torch.rms_norm = _rms_norm
torch.nanmean = _nanmean
torch.Tensor.nanmean = lambda self, dim=None, keepdim=False, **kw: _nanmean(self, dim, keepdim)

# The legacy tracer mis-exports `x[..., :-g]` style ellipsis slices in the cell embedder; use explicit narrow().
def _embed(self, x):
    g, L = self.group_size, x.shape[-1]
    fourier_out = self.fourier(x.narrow(-1, 0, g))
    ranks = x.narrow(-1, L - g, g)
    meta = torch.cat([x.narrow(-1, 0, L - g), arch._ecdf_fourier_features(ranks, self.ecdf_num_frequencies).flatten(-2)], dim=-1)
    return self.layernorm(fourier_out + F.linear(meta, self.metadata_linear.weight))

arch.FourierPlusMetadataFeatureGroupEmbedder._embed = _embed
fused.install()

B, R, C, N = 1, 80, 5, 60                        # example shapes; rows/cols/ntrain are dynamic axes, the estimator axis is static
w = (RegressionExportWrap(load_regressor()) if REGRESSION else ExportWrap(load_model())).eval()
y_example = torch.randn(N, 1) if REGRESSION else (torch.arange(N)[:, None] % 3).float()
example = (torch.randn(B, R, C), torch.zeros(B, R, C), torch.rand(B, R, C) * N, y_example)
rows_cols = {1: "rows", 2: "cols"}
torch.onnx.export(
    w, example, OUT, dynamo=False, opset_version=17, custom_opsets={"com.microsoft": 1},
    input_names=["x", "nan_ind", "ecdf", "y"], output_names=["logits"],
    dynamic_axes={"x": rows_cols, "nan_ind": rows_cols, "ecdf": rows_cols, "y": {0: "ntrain"}, "logits": {0: "ntest"}},
)
print("EXPORT OK", OUT)
