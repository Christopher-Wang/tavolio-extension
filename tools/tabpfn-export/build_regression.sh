#!/bin/sh
# Regression twin of build_model.sh: same pipeline, regression y-encoders/head (5000-bucket bar distribution), z-normed target in.
# Run inside the container:  docker compose run --rm -e TABPFN_TOKEN export sh build_regression.sh
set -e
O=/out
trap 'rm -f $O/r*.onnx $O/r*.onnx.data' EXIT
TASK=regression python export_onnx.py                                          # -> $O/tabpfn_fast_reg_fused_est1_fp32.onnx
python simplify_onnx.py $O/tabpfn_fast_reg_fused_est1_fp32.onnx $O/r1.onnx
python inline_if.py $O/r1.onnx $O/r2.onnx
python split_high_rank_concat.py $O/r2.onnx $O/r2b.onnx
python quantize_onnx.py $O/r2b.onnx $O/r3.onnx
python fp16_region.py $O/r3.onnx $O/tabpfn_fast_reg_client.onnx
FP16_RE='^$' python fp16_region.py $O/r3.onnx $O/tabpfn_fast_reg_client_f32.onnx
ls -la $O/tabpfn_fast_reg_client*.onnx*
