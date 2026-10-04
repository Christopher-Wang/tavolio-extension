#!/bin/sh
# TabPFN-3.5-Fast -> client model: 1 estimator, fused attention, simplified graph, INT4 RTN g128 weights, fp16 ICL activations.
# Run inside the container:  docker compose run --rm -e TABPFN_TOKEN export sh build_model.sh
set -e
O=/out
trap 'rm -f $O/s*.onnx $O/s*.onnx.data' EXIT                                   # intermediates, also on failure
python export_onnx.py                                                         # -> $O/tabpfn_fast_fused_est1_fp32.onnx (fused MHA, static est=1)
python simplify_onnx.py $O/tabpfn_fast_fused_est1_fp32.onnx $O/s1.onnx        # constant-fold shape plumbing
python inline_if.py $O/s1.onnx $O/s2.onnx                                     # remove the two rank-check Ifs
python split_high_rank_concat.py $O/s2.onnx $O/s2b.onnx                      # rank-5 Concat breaks ORT-web WebGPU on Metal
python quantize_onnx.py $O/s2b.onnx $O/s3.onnx                                 # INT4 RTN, block 128, asymmetric (MatMulNBits)
python fp16_region.py $O/s3.onnx $O/tabpfn_fast_client.onnx                   # fp16 ICL stack, fp32 islands
FP16_RE='^$' python fp16_region.py $O/s3.onnx $O/tabpfn_fast_client_f32.onnx  # same INT4 weights, fp32 activations: for GPUs without shader-f16 and for software-WebGPU tests
ls -la $O/tabpfn_fast_client.onnx*
python eval_real.py
