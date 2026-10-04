// usage (in the container): node run.mjs [model file] [cases]   e.g. node run.mjs tabpfn_fast_client_f32.onnx iris,wine
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const [model = "tabpfn_fast_client_f32.onnx", cases = "iris,wine"] = process.argv.slice(2);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
const roots = { ort: "/bt/node_modules/onnxruntime-web/dist", model: "/model" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = normalize(decodeURIComponent(url.pathname));
  let file;
  if (path === "/") file = "/bt/page/page.html";
  else if (path === "/parity.json") file = "/model/model-parity.json";
  else if (path.startsWith("/ort/")) file = join(roots.ort, path.slice(5));
  else if (path.startsWith("/model/")) file = join(roots.model, path.slice(7));
  else if (path.startsWith("/pkg/")) { const [, , name, ...rest] = path.split("/"); file = join("/repo/packages", name, "dist", ...rest); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("not found: " + path); }
}).listen(0);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM, headless: true,
  args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader",
         "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--in-process-gpu", "--disable-gpu-sandbox"],
});
const page = await browser.newPage();
page.on("console", (m) => console.log("  [page]", m.text().slice(0, 600)));
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 600)));
await page.goto(`http://localhost:${server.address().port}/?model=${model}&cases=${cases}`);
const result = await page.waitForFunction(() => window.__result, null, { timeout: 25 * 60_000 }).then((h) => h.jsonValue());
console.log("RESULT", JSON.stringify(result));
await browser.close();
server.close();
process.exit(result.ok ? 0 : 1);
