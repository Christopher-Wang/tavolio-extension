FROM python:3.12-slim
WORKDIR /work
# CPU torch first so tabpfn doesn't pull CUDA wheels.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir tabpfn scikit-learn pandas numpy onnx onnx-ir onnxruntime onnxsim
ENV HF_HOME=/cache/hf TABPFN_MODEL_CACHE_DIR=/cache/tabpfn
