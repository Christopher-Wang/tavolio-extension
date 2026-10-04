import type { ModelManifest } from "../types.js";

export const LOCAL_TABULAR_MANIFEST: ModelManifest = {
  id: "local-tabular-v1",
  displayName: "Linear baseline",
  version: "0.1.0",
  taskKinds: ["classification", "regression"],
  artifact: { uri: "none", format: "onnx" },
};
