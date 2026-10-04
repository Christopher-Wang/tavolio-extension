"""Dump the regression head's fixed bar-distribution bucket means (tails use the half-normal refinement of FullSupportBarDistribution.mean),
as float32 base64, for packages/models/src/tabpfn/bucketMeans.ts. usage: make_bucket_means.py > /fixtures/tabpfn-bucket-means.b64"""
import base64, sys, numpy as np, torch
from tabpfn.architectures.shared.bar_distribution import FullSupportBarDistribution
from wrapper import load_regressor
b = load_regressor().heads.regression_borders.float()
d = FullSupportBarDistribution(b)
means = d.mean(torch.nn.functional.one_hot(torch.arange(len(b) - 1), len(b) - 1).float() * 1e4)   # near-one-hot logits -> each bucket's mean
means = means.detach().numpy().astype("<f4")
# sanity: one-hot logits give the bucket mean back for interior buckets
mid = ((b[:-1] + b[1:]) / 2).numpy()
print("buckets", len(means), "interior max |mean-mid|", float(np.abs(means[1:-1] - mid[1:-1]).max()), "tails", means[0], means[-1], file=sys.stderr)
sys.stdout.write(base64.b64encode(means.tobytes()).decode())
