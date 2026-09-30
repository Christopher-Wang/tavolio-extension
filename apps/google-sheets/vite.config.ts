import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Excel and the Sheets iframe both need HTTPS. `docker/gen-certs.sh` writes a local
// certificate to .docker/certs; without it the dev server falls back to plain HTTP.
const certs = fileURLToPath(new URL("../../.docker/certs/", import.meta.url));
const https = existsSync(`${certs}localhost.pem`)
  ? { key: readFileSync(`${certs}localhost-key.pem`), cert: readFileSync(`${certs}localhost.pem`) }
  : undefined;

// Normal multi-file build (Pages, and the localhost server Sheets/Excel iframe). base "./" so it works under
// the Pages sub-path. Nothing is inlined, so ORT wasm/worker/model files can sit next to the bundle.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "0.0.0.0", port: 3000, strictPort: true, https },
  preview: { host: "0.0.0.0", port: 3000, https },
});
