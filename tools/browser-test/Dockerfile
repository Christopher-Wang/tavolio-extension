# Headless Chromium with software WebGPU (SwiftShader), to run the real ORT-web + WebGPU path without a GPU.
# SwiftShader has no shader-f16, so this exercises session creation / op coverage and the fp32-activation model; the fp16 model needs a real GPU.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium libvulkan1 mesa-vulkan-drivers ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /bt
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright-core onnxruntime-web@1.30.0
ENV CHROMIUM=/usr/bin/chromium
