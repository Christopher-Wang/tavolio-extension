/** Tiny in-memory artifact cache. Swap for Cache Storage / OPFS in the browser. */
export class ArtifactCache {
  private store = new Map<string, ArrayBuffer>();

  has(key: string): boolean {
    return this.store.has(key);
  }

  get(key: string): ArrayBuffer | undefined {
    return this.store.get(key);
  }

  set(key: string, value: ArrayBuffer): void {
    this.store.set(key, value);
  }

  clear(): void {
    this.store.clear();
  }
}

export const globalArtifactCache = new ArtifactCache();
