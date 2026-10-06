// Static server for apps/google-sheets/dist, used by `make serve`. Unlike `vite preview` it reads
// files on every request, so it keeps working while `vite build --watch` rewrites dist.
// CORS + Private Network Access headers let the Sheets sidebar load scripts from here.
// /relay/upload stands in for the server half Excel doesn't have: Prior Labs hands out signed Google Cloud Storage URLs that send no
// CORS headers, so the task pane can't PUT to them itself (Sheets does it through Apps Script). A hosted backend replaces this.
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

const UPLOAD_HOST = "storage.googleapis.com";
const MAX_UPLOAD = 64 * 1024 * 1024;

/** PUT /relay/upload?url=<signed URL>: forwards the body, Content-Type and x-goog-* headers (they are part of the signature) and answers with the status. */
async function relayUpload(req, res, target, headers) {
  const reply = (status, text) => res.writeHead(status, { ...headers, "Content-Type": "text/plain" }).end(text);
  let url;
  try {
    url = new URL(target ?? "");
  } catch {
    return reply(400, "bad url");
  }
  if (url.protocol !== "https:" || url.hostname !== UPLOAD_HOST) return reply(400, "only signed " + UPLOAD_HOST + " URLs are relayed");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD) return reply(413, "too large");
    chunks.push(chunk);
  }
  const forward = {};
  for (const [name, value] of Object.entries(req.headers)) if (name === "content-type" || name.startsWith("x-goog-")) forward[name] = value;
  try {
    const up = await fetch(url, { method: "PUT", headers: forward, body: Buffer.concat(chunks) });
    reply(up.status, await up.text());
  } catch (e) {
    reply(502, String(e));
  }
}

async function handle(req, res) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-cache",
  };
  if (req.method === "OPTIONS") return res.writeHead(204, headers).end();
  const parsed = new URL(req.url, "http://x");
  if (req.method === "PUT" && parsed.pathname === "/relay/upload") return relayUpload(req, res, parsed.searchParams.get("url"), headers);
  const path = normalize(decodeURIComponent(parsed.pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const file = path.startsWith("/models/") ? join(modelsRoot, path.slice("/models/".length)) : join(root, path.endsWith("/") ? path + "index.html" : path);
    const body = await readFile(file);
    res.writeHead(200, { ...headers, "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(body);
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
