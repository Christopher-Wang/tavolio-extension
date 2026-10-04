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

/** Makes TabPFN through the Prior Labs API available to predictTable. Nothing is sent anywhere until a run picks it. */
export function registerTabPfnApi(call: Call = appsScriptCall): { modelId: string; keys: ApiKeyStore } {
  const keys = keyStore(call);
  modelRegistry.register(
    new TabPfnModel({
      manifest: TABPFN_API_MANIFEST,
      predictor: new HostedTabPfnPredictor(transport(call)),
      ensureReady: async () => ((await keys.has()) ? null : "no Prior Labs API key is set"),
      fallback: new LocalTabularModel(),
    }),
  );
  return { modelId: TABPFN_API_MANIFEST.id, keys };
}
