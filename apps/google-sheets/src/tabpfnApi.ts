import {
  HostedTabPfnPredictor,
  LocalTabularModel,
  TABPFN_API_MANIFEST,
  TabPfnModel,
  modelRegistry,
  type ApiKeyStore,
  type HostedTransport,
} from "@tavolio/models";
import { appsScriptCall, type Call } from "./sheetsBridge.js";

/** Calls and key live in Apps Script (Code.gs): the API refuses requests from the sidebar's origin, and each user's key stays server-side. */
function transport(call: Call): HostedTransport {
  return {
    request: (method, path, body) => call("tavolioApiRequest", method, path, body ?? null),
    upload: (url, headers, body) => call("tavolioApiUpload", url, headers, body),
  };
}

function keyStore(call: Call): ApiKeyStore {
  return {
    has: () => call<boolean>("tavolioApiKeySet"),
    set: (key) => call<void>("tavolioApiKeySave", key),
    clear: () => call<void>("tavolioApiKeyClear"),
  };
}

const PRIORLABS_API = "https://api.priorlabs.ai";
const KEY_STORAGE = "tavolio-priorlabs-api-key";

/**
 * Excel has no server-side half like Apps Script, so the task pane calls the API itself (api.priorlabs.ai allows this page's origin)
 * and keeps the key in this browser's storage: per device, never written into the workbook. The signed upload URLs it gets back
 * point at Google Cloud Storage, which sends no CORS headers, so those PUTs go through /relay/upload on the server that serves
 * this bundle (docker/serve-dist.mjs, `make serve`). Concatenated, not a template literal: see modelUrl in tabpfn.ts.
 */
const relayUrl = (target: string) => new URL("../relay/upload?url=" + encodeURIComponent(target), import.meta.url).href;

const directTransport: HostedTransport = {
  async request(method, path, body) {
    const res = await fetch(PRIORLABS_API + path, {
      method,
      headers: { Authorization: "Bearer " + (readKey() ?? ""), ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
  async upload(url, headers, body) {
    if (!/^https:\/\//.test(url)) throw new Error("Unexpected upload address");
    // The browser sets these itself.
    const send = Object.fromEntries(Object.entries(headers).filter(([h]) => !["host", "content-length"].includes(h.toLowerCase())));
    return { status: (await fetch(relayUrl(url), { method: "PUT", headers: send, body })).status };
  },
};

function readKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

const browserKeys: ApiKeyStore = {
  has: async () => !!readKey(),
  set: async (key) => {
    const trimmed = key.trim();
    if (!trimmed) throw new Error("Enter an API key");
    try {
      localStorage.setItem(KEY_STORAGE, trimmed);
    } catch {
      throw new Error("This browser won't store the key");
    }
  },
  clear: async () => {
    try {
      localStorage.removeItem(KEY_STORAGE);
    } catch {
      // Nothing stored.
    }
  },
};

/**
 * Makes TabPFN through the Prior Labs API available to predictTable. Nothing is sent anywhere until a run picks it.
 * `where` picks how the host reaches the API and keeps the key: Apps Script for Sheets, the pane itself for Excel.
 */
export function registerTabPfnApi(where: "apps-script" | "browser", call: Call = appsScriptCall): { modelId: string; keys: ApiKeyStore; keyHint: string } {
  const keys = where === "browser" ? browserKeys : keyStore(call);
  const hosted = where === "browser" ? directTransport : transport(call);
  modelRegistry.register(
    new TabPfnModel({
      manifest: TABPFN_API_MANIFEST,
      predictor: new HostedTabPfnPredictor(hosted),
      ensureReady: async () => ((await keys.has()) ? null : "no Prior Labs API key is set"),
      fallback: new LocalTabularModel(),
    }),
  );
  const keyHint = where === "browser" ? "It is stored in this browser on this device only." : "It is stored for your Google account only.";
  return { modelId: TABPFN_API_MANIFEST.id, keys, keyHint };
}
