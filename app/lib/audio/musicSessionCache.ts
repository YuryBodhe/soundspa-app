export const MAX_MUSIC_SESSION_CACHE_BYTES = 150 * 1024 * 1024;

type CacheEntry = {
  blob: Blob;
  lastUsed: number;
};

export class MusicSessionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;
  private useSequence = 0;

  constructor(private readonly maxBytes = MAX_MUSIC_SESSION_CACHE_BYTES) {}

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) {
      this.log("cache-get", { key, hit: false, entryCount: this.entries.size, sizeBytes: this.totalBytes });
      return null;
    }
    entry.lastUsed = ++this.useSequence;
    this.log("cache-get", { key, hit: true, blobSize: entry.blob.size, entryCount: this.entries.size, sizeBytes: this.totalBytes });
    return entry.blob;
  }

  put(key: string, blob: Blob, protectedKeys: ReadonlySet<string> = new Set()) {
    if (blob.size > this.maxBytes) {
      this.log("cache-put", { key, blobSize: blob.size, stored: false, entryCount: this.entries.size, sizeBytes: this.totalBytes });
      return false;
    }

    const previous = this.entries.get(key);
    if (previous) this.totalBytes -= previous.blob.size;
    this.entries.set(key, { blob, lastUsed: ++this.useSequence });
    this.totalBytes += blob.size;

    while (this.totalBytes > this.maxBytes) {
      const candidate = [...this.entries.entries()]
        .filter(([entryKey]) => !protectedKeys.has(entryKey))
        .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) break;
      const [candidateKey, candidateEntry] = candidate;
      this.entries.delete(candidateKey);
      this.totalBytes -= candidateEntry.blob.size;
      this.log("cache-evict", { key: candidateKey, blobSize: candidateEntry.blob.size, reason: "capacity" });
    }

    const stored = this.entries.has(key);
    this.log("cache-put", { key, blobSize: blob.size, stored, entryCount: this.entries.size, sizeBytes: this.totalBytes });
    return stored;
  }

  logSnapshot(context: string) {
    this.log("cache-snapshot", {
      context,
      entries: [...this.entries.entries()].map(([key, entry]) => ({ key, blobSize: entry.blob.size })),
      entryCount: this.entries.size,
      sizeBytes: this.totalBytes,
    });
  }

  get sizeBytes() {
    return this.totalBytes;
  }

  get entryCount() {
    return this.entries.size;
  }

  private log(event: string, details: Record<string, unknown>) {
    console.info(`[MusicSessionCache] ${event}`, details);
  }
}

export const musicSessionCache = new MusicSessionCache();
