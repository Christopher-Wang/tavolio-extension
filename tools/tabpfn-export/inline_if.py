"""Replace the two `If` nodes (a rank check on y: "squeeze a trailing dim of 1 if present") with their Squeeze branch.
The tensor always has that trailing dim here. usage: inline_if.py src dst"""
import os, sys, onnx
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
nodes, n_if = [], 0
for n in m.graph.node:
    if n.op_type != "If":
        nodes.append(n); continue
    br = [a.g for a in n.attribute if a.type == onnx.AttributeProto.GRAPH and {x.op_type for x in a.g.node} == {"Squeeze"}]
    assert len(br) == 1, f"cannot inline {n.name}"
    g = br[0]
    m.graph.initializer.extend(g.initializer)
    for bn in g.node:
        bn.name = f"{n.name}_inl_{bn.name}"; nodes.append(bn)
    nodes.append(onnx.helper.make_node("Identity", [g.output[0].name], [n.output[0]], name=n.name + "_inlined")); n_if += 1
del m.graph.node[:]; m.graph.node.extend(nodes)
print("inlined", n_if, "If nodes")
if os.path.exists(dst + ".data"): os.remove(dst + ".data")   # onnx appends to an existing external-data file
onnx.save_model(m, dst, save_as_external_data=True, all_tensors_to_one_file=True, location=dst.split("/")[-1] + ".data")
