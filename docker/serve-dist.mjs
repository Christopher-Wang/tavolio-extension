// Static server for apps/google-sheets/dist, used by `make serve`. Unlike `vite preview` it reads
// files on every request, so it keeps working while `vite build --watch` rewrites dist.
// CORS + Private Network Access headers let the Sheets sidebar load scripts from here.
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "apps/google-sheets/dist");
// The TabPFN model files are not part of the bundle (and not in git): serve them from the build output of tools/tabpfn-export.
const modelsRoot = process.env.MODELS_DIR ?? join(process.cwd(), "tools/tabpfn-export/out");
const certs = join(process.cwd(), ".docker/certs");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".wasm": "application/wasm", ".onnx": "application/octet-stream" };

async function handle(req, res) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-cache",
  };
  if (req.method === "OPTIONS") return res.writeHead(204, headers).end();
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const file = path.startsWith("/models/") ? join(modelsRoot, path.slice("/models/".length)) : join(root, path.endsWith("/") ? path + "index.html" : path);
    const body = await readFile(file);
    res.writeHead(200, { ...headers, "Content-Type": types[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, headers).end("not found");
  }
}

const tls = existsSync(join(certs, "localhost.pem"))
  ? { key: readFileSync(join(certs, "localhost-key.pem")), cert: readFileSync(join(certs, "localhost.pem")) }
  : null;
(tls ? createServer(tls, handle) : createHttpServer(handle)).listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () =>
  console.log(`serving ${root} on ${tls ? "https" : "http"}://localhost:${process.env.PORT ?? 3000}`),
);
