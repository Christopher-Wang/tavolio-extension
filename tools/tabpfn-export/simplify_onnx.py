"""Constant-fold / simplify shape plumbing. usage: simplify_onnx.py src dst"""
import os, sys, collections, onnx
from onnxsim import simplify
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
cnt = lambda mm: collections.Counter(n.op_type for n in mm.graph.node)
before = cnt(m); print("before:", sum(before.values()), "nodes;", before.most_common(6))
ms, ok = simplify(m, skip_fuse_bn=True, check_n=0)
after = cnt(ms); print("after: ", sum(after.values()), "nodes;", after.most_common(6), "| check:", ok)
if os.path.exists(dst + ".data"): os.remove(dst + ".data")   # onnx appends to an existing external-data file
onnx.save_model(ms, dst, save_as_external_data=True, all_tensors_to_one_file=True, location=dst.split("/")[-1] + ".data")
