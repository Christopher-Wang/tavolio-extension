"""Export-friendly view of TabPFNV3p5 (multiclass, no KV cache). The graph starts AFTER the model's data-dependent
front-end (`_preprocess_raw`: NaN indicators, mean imputation, standard scaling, ECDF ranks), which the TypeScript side
reimplements; that front-end needs sort/searchsorted which ONNX can't express efficiently."""
import dataclasses, torch
from tabpfn import TabPFNClassifier
from tabpfn.constants import ModelVersion

NUM_CLASSES = 64   # fixed one-hot width (<= decoder head_dim, so one attention pass); logits are still padded to 160

class ExportWrap(torch.nn.Module):
    def __init__(self, m, num_classes=NUM_CLASSES):
        super().__init__()
        self.m, self.k = m, num_classes
        self.opts = dataclasses.replace(m.get_default_performance_options(), use_chunkwise_inference=False)

    def forward(self, x, nan_ind, ecdf, y):
        """x, nan_ind, ecdf: (est, rows, cols) float, train rows first (rows = n_train + n_test).
        y: (n_train, est) float class ids in [0, k), one column per estimator (each has its own class permutation).
        -> (n_test, est, 160) logits."""
        m = self.m
        n, B, R = y.shape[0], x.shape[0], x.shape[1]
        y_col = m._embed_col_y(m._prepare_y(y, n, B, task_type="multiclass"), task_type="multiclass")
        xg = m._group_features(x, nan_ind, ecdf)
        h, _ = m._process_row_chunk(
            x_grouped_chunk_BRjCG=xg, y_col_emb=y_col, chunk_start=0, chunk_end=R, effective_num_train=n,
            precomputed_hidden=None, save_peak_memory_factor=self.opts.save_peak_memory_factor,
            force_recompute_layer=False, return_inducing_hidden=False, is_full_path=True)
        h = h.flatten(-2)
        h[:, :n] = h[:, :n] + m._embed_icl_y(m._prepare_y(y, n, B, task_type="multiclass"), task_type="multiclass")
        for blk in m.icl_blocks:
            h, _ = blk(h, n, self.opts.save_peak_memory_factor)
        h = m.output_norm(h)
        keys = m.heads.project_decoder_keys(h[:, :n])
        out = m.heads(keys, h[:, n:], y.transpose(0, 1), task_type="multiclass", num_present_classes=self.k)
        return torch.nan_to_num(out, nan=0.0) if m._nan_safe_output else out

def load_model():
    import numpy as np, pandas as pd
    clf = TabPFNClassifier.create_default_for_version(ModelVersion.V3_5_FAST, device="cpu")
    clf.fit(pd.DataFrame(np.random.default_rng(0).normal(size=(60, 5))), np.arange(60) % 3)
    return clf.models_[0].eval()

def frontend(m, x_raw, n_train):
    """Python reference for the front-end the TS side must reproduce: (rows, est, cols) raw -> three (est, rows, cols) tensors."""
    x, nan, ecdf, _ = m._preprocess_raw(x_raw, n_train)
    return x, nan, ecdf


class RegressionExportWrap(torch.nn.Module):
    """Same graph for the regression task: y is the z-normalised target, the output is the 5000-bucket bar-distribution logits."""
    def __init__(self, m):
        super().__init__()
        self.m = m
        self.opts = dataclasses.replace(m.get_default_performance_options(), use_chunkwise_inference=False)

    def forward(self, x, nan_ind, ecdf, y):
        """x, nan_ind, ecdf: (est, rows, cols), train rows first. y: (n_train, est) float z-scores. -> (n_test, est, 5000) logits."""
        m = self.m
        n, B, R = y.shape[0], x.shape[0], x.shape[1]
        y_col = m._embed_col_y(m._prepare_y(y, n, B, task_type="regression"), task_type="regression")
        xg = m._group_features(x, nan_ind, ecdf)
        h, _ = m._process_row_chunk(
            x_grouped_chunk_BRjCG=xg, y_col_emb=y_col, chunk_start=0, chunk_end=R, effective_num_train=n,
            precomputed_hidden=None, save_peak_memory_factor=self.opts.save_peak_memory_factor,
            force_recompute_layer=False, return_inducing_hidden=False, is_full_path=True)
        h = h.flatten(-2)
        h[:, :n] = h[:, :n] + m._embed_icl_y(m._prepare_y(y, n, B, task_type="regression"), task_type="regression")
        for blk in m.icl_blocks:
            h, _ = blk(h, n, self.opts.save_peak_memory_factor)
        h = m.output_norm(h)
        out = m.heads(None, h[:, n:], y.transpose(0, 1), task_type="regression", num_present_classes=None)
        return torch.nan_to_num(out, nan=0.0) if m._nan_safe_output else out

def load_regressor():
    import numpy as np, pandas as pd
    from tabpfn import TabPFNRegressor
    r = TabPFNRegressor.create_default_for_version(ModelVersion.V3_5_FAST, device="cpu")
    rng = np.random.default_rng(0)
    r.fit(pd.DataFrame(rng.normal(size=(60, 5))), rng.normal(size=60))
    return r.models_[0].eval()
