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

// Normal multi-file build, served from localhost by `make serve` (Sheets sidebar and Excel task pane). base "./" keeps
// asset URLs relative so the build works from any origin or sub-path. Nothing is inlined, so ORT wasm/worker/model
// files can sit next to the bundle.
export default defineConfig({
  plugins: [react()],
  base: "./",
  // Stable entry name: appsscript/Loader.html loads assets/app.js directly into the Sheets sidebar.
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { output: { entryFileNames: "assets/app.js" } } },
  // The Sheets sidebar can load scripts from here directly, so allow any origin (Vite 6 defaults to
  // localhost-only CORS) and answer Chrome's Private Network Access preflight. Firefox ignores the latter.
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    https,
    cors: true,
    headers: { "Access-Control-Allow-Private-Network": "true" },
  },
  preview: {
    host: "0.0.0.0",
    port: 3000,
    https,
    cors: true,
    headers: { "Access-Control-Allow-Private-Network": "true" },
  },
});
