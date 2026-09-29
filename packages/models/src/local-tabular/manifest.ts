import type { ModelManifest } from "../types.js";

export const LOCAL_TABULAR_MANIFEST: ModelManifest = {
  id: "local-tabular-v1",
  displayName: "Local Tabular v1",
  version: "0.1.0",
  taskKinds: ["classification", "regression"],
  artifact: { uri: "models/local-tabular-v1.onnx", format: "onnx" },
};
