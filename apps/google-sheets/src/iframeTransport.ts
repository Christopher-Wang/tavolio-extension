import type { Call } from "./sheetsBridge.js";

/**
 * Transport for the hosted build embedded in the Sheets sidebar. The Apps
 * Script shell (appsscript/Shell.html) owns google.script.run and relays these
 * messages; it only forwards an allowlist of functions.
 */

export function isEmbeddedInSheetsShell(): boolean {
  return window.parent !== window && new URLSearchParams(location.search).get("host") === "sheets";
}

interface Reply {
  tavolio: 1;
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextId = 1;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (e: MessageEvent<Reply>) => {
    if (e.source !== window.parent || e.data?.tavolio !== 1) return;
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.value);
    else p.reject(new Error(e.data.error ?? "Apps Script call failed"));
  });
}

export const iframeCall: Call = <T>(fn: string, ...args: unknown[]) => {
  listen();
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    // The parent's origin is a per-script googleusercontent subdomain, so it can't be pinned here;
    // the shell pins ours on its side, and replies are only accepted from window.parent.
    window.parent.postMessage({ tavolio: 1, id, fn, args }, "*");
  });
};
