# onnxruntime-node ships glibc binaries only, so the real-model tests can't run in the Alpine images used elsewhere.
# Version matches the Python onnxruntime that builds the model (tools/tabpfn-export).
FROM node:22-bookworm-slim
WORKDIR /ort
RUN npm init -y >/dev/null && npm install --no-audit --no-fund onnxruntime-node@1.30.0
ENV ORT_NODE_DIR=/ort
