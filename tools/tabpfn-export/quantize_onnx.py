"""INT4 round-to-nearest, block size 128, asymmetric (scale + zero point) -> MatMulNBits nodes. usage: quantize_onnx.py src dst
Expects the graph to be simplified first (onnxsim folds the Identity nodes the exporter puts in front of some weights; without that
the quantizer skips those MatMuls, e.g. the 2048x1024 head MLP stays fp32)."""
import os, sys, onnx
from onnxruntime.quantization import matmul_nbits_quantizer as q

src, dst = sys.argv[1], sys.argv[2]
quant = q.MatMulNBitsQuantizer(onnx.load(src), algo_config=q.DefaultWeightOnlyQuantConfig(block_size=128, is_symmetric=False, bits=4))
quant.process()
if os.path.exists(dst + ".data"): os.remove(dst + ".data")   # the quantizer appends to an existing external-data file too
quant.model.save_model_to_file(dst, True)
print("quantized MatMuls:", sum(n.op_type == "MatMulNBits" for n in onnx.load(dst, load_external_data=False).graph.node))
