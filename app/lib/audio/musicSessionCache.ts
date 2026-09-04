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
    if (!entry) return null;
    entry.lastUsed = ++this.useSequence;
    return entry.blob;
  }

  put(key: string, blob: Blob, protectedKeys: ReadonlySet<string> = new Set()) {
    if (blob.size > this.maxBytes) return false;

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
    }

    return this.entries.has(key);
  }

  get sizeBytes() {
    return this.totalBytes;
  }

  get entryCount() {
    return this.entries.size;
  }
}

export const musicSessionCache = new MusicSessionCache();
