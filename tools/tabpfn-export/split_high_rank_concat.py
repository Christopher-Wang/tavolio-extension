"""ORT-web's WebGPU Concat kernel fails to compile on Metal for rank >= 5 inputs (Tint: set_output_by_indices called with an
input indices type). Rewrite each such last-axis Concat as Reshape -> rank-3 Concat -> Reshape. usage: split_high_rank_concat.py src dst"""
import os, sys, onnx
from onnx import TensorProto as T, helper as h, numpy_helper as nh
import numpy as np
src, dst = sys.argv[1:3]
m = onnx.load(src)
g = m.graph
dims = {v.name: [d.dim_value if d.HasField("dim_value") else None for d in v.type.tensor_type.shape.dim]
        for v in list(onnx.shape_inference.infer_shapes(m).graph.value_info) + list(g.input)}
const = lambda name, vals: nh.from_array(np.array(vals, dtype=np.int64), name)
new, count = [], 0
for n in g.node:
    shp = [dims.get(i) for i in n.input]
    axis = next((a.i for a in n.attribute if a.name == "axis"), 0)
    if n.op_type != "Concat" or any(s is None or len(s) < 5 for s in shp):
        new.append(n); continue
    r = len(shp[0])
    assert axis in (-1, r - 1) and all(s[r - 2] and s[r - 1] for s in shp), f"{n.name}: unsupported high-rank concat {shp} axis {axis}"
    mid, p = shp[0][r - 2], f"{n.name}/r3"
    flat = []
    for k, (i, s) in enumerate(zip(n.input, shp)):
        g.initializer.append(const(f"{p}/shape{k}", [-1, mid, s[r - 1]]))
        new.append(h.make_node("Reshape", [i, f"{p}/shape{k}"], [f"{p}/in{k}"], name=f"{p}/reshape{k}"))
        flat.append(f"{p}/in{k}")
    g.initializer.append(const(f"{p}/lead_start", [0])); g.initializer.append(const(f"{p}/lead_end", [r - 2]))
    g.initializer.append(const(f"{p}/tail", [mid, sum(s[r - 1] for s in shp)]))
    new += [
        h.make_node("Concat", flat, [f"{p}/cat"], axis=2, name=f"{p}/concat"),
        h.make_node("Shape", [n.input[0]], [f"{p}/shape_in"], name=f"{p}/shape"),
        h.make_node("Slice", [f"{p}/shape_in", f"{p}/lead_start", f"{p}/lead_end"], [f"{p}/lead"], name=f"{p}/lead_slice"),
        h.make_node("Concat", [f"{p}/lead", f"{p}/tail"], [f"{p}/out_shape"], axis=0, name=f"{p}/out_shape_concat"),
        h.make_node("Reshape", [f"{p}/cat", f"{p}/out_shape"], list(n.output), name=f"{p}/reshape_out"),
    ]
    count += 1
del g.node[:]
g.node.extend(new)
print("rewrote", count, "rank>=5 Concat nodes")
if os.path.exists(dst + ".data"): os.remove(dst + ".data")
onnx.save_model(m, dst, save_as_external_data=True, all_tensors_to_one_file=True, location=dst.split("/")[-1] + ".data")
