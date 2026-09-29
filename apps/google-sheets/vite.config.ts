import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Apps Script's HtmlService serves one HTML file with no static assets, so the
// production build inlines all JS/CSS into dist/index.html (-> Sidebar.html).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "0.0.0.0", port: 5173 },
});
