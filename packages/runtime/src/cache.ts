export interface FetchProgress {
  loaded: number;
  /** From Content-Length when the server sends it. */
  total?: number;
}

export interface FetchBytesOptions {
  /** Cache Storage bucket. Default "tavolio-models". */
  cacheName?: string;
  /** Called while downloading; never called for a cache hit. */
  onProgress?: (p: FetchProgress) => void;
}

/**
 * Fetch a (large) file through the browser's Cache Storage so it downloads once, reporting progress while it does.
 * The URL is the cache key: put a version in it (`?v=…`) so a rebuilt file isn't served stale.
 * Cache Storage can be unavailable (some sandboxed iframes, private modes) or full; then this is a plain fetch.
 */
export async function fetchBytesCached(url: string, options: FetchBytesOptions = {}): Promise<Uint8Array> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open(options.cacheName ?? "tavolio-models");
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = undefined;
  }

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download ${url} (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || undefined;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    options.onProgress?.({ loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }

  try {
    await cache?.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
  } catch {
    // Quota or storage errors only cost a re-download next time.
  }
  return bytes;
}
