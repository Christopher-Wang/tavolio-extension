// Collect everything Apps Script needs into dist/appsscript/: the single-file
// sidebar build (as Sidebar.html) plus Code.gs, GpuProbe.html, appsscript.json.
import { cpSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "dist", "appsscript");
mkdirSync(out, { recursive: true });
renameSync(join(root, "dist", "index.html"), join(out, "Sidebar.html"));
for (const f of readdirSync(join(root, "appsscript"))) cpSync(join(root, "appsscript", f), join(out, f));
console.log(`Apps Script bundle ready: ${readdirSync(out).join(", ")} in dist/appsscript/`);
