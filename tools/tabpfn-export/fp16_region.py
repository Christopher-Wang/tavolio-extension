"""Region-based fp16: convert only whitelisted float ops inside a node-name region to fp16, everything else stays fp32, and Casts are
inserted only where a tensor crosses between the two (ORT's generic converter mangled this graph).
Precision-sensitive ops stay fp32 islands because they're not whitelisted: MultiHeadAttention (SSMax-scaled queries reach ~1e4, scores
overflow fp16), Pow/ReduceMean/Sqrt (RMSNorm statistics overflow past |x|>256), Softmax/Exp, Cast, and all shape math.
usage: fp16_region.py src dst   (env FP16_RE = node-name regex for the region)"""
import os, sys, os, re, collections, numpy as np, onnx
from onnx import TensorProto as TP, helper, numpy_helper, shape_inference

src, dst = sys.argv[1], sys.argv[2]
RE = re.compile(os.environ.get("FP16_RE", r"^(/icl_blocks\.|/output_norm|/heads/mlp_classification|/heads/mlp_regression)"))
OPS = {"MatMul", "MatMulNBits", "Gemm", "Add", "Sub", "Mul", "Div", "Neg", "Erf", "Gelu", "Tanh", "Relu", "Sigmoid", "Transpose", "Reshape",
       "Flatten", "Concat", "Slice", "Squeeze", "Unsqueeze", "Expand", "Identity", "Split", "Gather", "Where"}
m = onnx.load(src)                                   # loads external data
inferred = shape_inference.infer_shapes(m, data_prop=False)
elem = {v.name: v.type.tensor_type.elem_type for v in list(inferred.graph.value_info) + list(inferred.graph.input) + list(inferred.graph.output)}
inits = {t.name: t for t in m.graph.initializer}
for n, t in inits.items(): elem[n] = t.data_type
is_f = lambda t: elem.get(t) == TP.FLOAT
S = {n.name for n in m.graph.node if RE.match(n.name) and n.op_type in OPS}
print(f"region nodes converted to fp16: {len(S)} of {len(m.graph.node)} | ops:", collections.Counter(n.op_type for n in m.graph.node if n.name in S).most_common(8))
unlisted = collections.Counter(n.op_type for n in m.graph.node if RE.match(n.name) and n.op_type not in OPS)
print("fp32 islands inside region (not whitelisted):", unlisted.most_common(8))

half = {t: False for t in elem}                      # tensor currently fp16?
new_inits, out_nodes, memo = [], [], {}
def to_half(t):                                      # fp16 version of float tensor t
    if half.get(t): return t
    key = (t, 16)
    if key not in memo:
        if t in inits:
            memo[key] = t + "__f16"
            new_inits.append(numpy_helper.from_array(numpy_helper.to_array(inits[t]).astype(np.float16), memo[key]))
        else:
            memo[key] = t + "__f16"; out_nodes.append(helper.make_node("Cast", [t], [memo[key]], to=TP.FLOAT16, name=f"cast16_{len(out_nodes)}"))
    return memo[key]
def to_full(t):
    if not half.get(t): return t
    key = (t, 32)
    if key not in memo:
        memo[key] = t + "__f32"; out_nodes.append(helper.make_node("Cast", [t], [memo[key]], to=TP.FLOAT, name=f"cast32_{len(out_nodes)}"))
    return memo[key]

for n in m.graph.node:
    if n.name in S:
        for k, i in enumerate(n.input):
            if i and is_f(i): n.input[k] = to_half(i)
        out_nodes.append(n)
        for o in n.output:
            if is_f(o): half[o] = True
    else:
        for k, i in enumerate(n.input):
            if i and half.get(i): n.input[k] = to_full(i)
        out_nodes.append(n)
for o in m.graph.output: assert not half.get(o.name), f"graph output {o.name} would be fp16"
del m.graph.node[:]; m.graph.node.extend(out_nodes)
m.graph.initializer.extend(new_inits)
del m.graph.value_info[:]                            # stale float types; ORT re-infers
# drop initializers no longer referenced
used = {i for n in m.graph.node for i in n.input}
keep = [t for t in m.graph.initializer if t.name in used]
print(f"casts inserted: {sum(1 for n in out_nodes if n.op_type == 'Cast' and n.name.startswith(('cast16_', 'cast32_')))} | initializers {len(m.graph.initializer)} -> {len(keep)}")
del m.graph.initializer[:]; m.graph.initializer.extend(keep)
if os.path.exists(dst + ".data"): os.remove(dst + ".data")   # onnx appends to an existing external-data file
onnx.save_model(m, dst, save_as_external_data=True, all_tensors_to_one_file=True, location=dst.split("/")[-1] + ".data")
print("saved", dst)
