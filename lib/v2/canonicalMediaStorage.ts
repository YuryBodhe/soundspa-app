import { UploadError } from "./uploadError";
import { localMediaStorage } from "./localMediaStorage";

export type ChannelReference = { kind: "music" | "ambient"; imageKey: string | null };
export type TrackReference = { storageKey: string; sizeBytes: bigint; isEnabled: boolean };

// Keys are immutable object identities. Only publication accepts a validated
// workspace file; callers never receive a canonical filesystem path.
export interface CanonicalMediaStorage {
  // On success publication is complete. Do not add fallible work after the
  // object becomes visible: callers account for DB failures as orphan reviews.
  publishImmutable(source: string, key: string): Promise<void>;
  isAlreadyExistsError(error: unknown): boolean;
  size(key: string): Promise<number>;
  matchesOwnedTrack(key: string, expected: { size?: number; sha256: string }): Promise<boolean>;
  inspectOwnedTrack(key: string): Promise<{ missing: boolean }>;
  removeOwnedTrack(key: string): Promise<"removed" | "already-missing">;
  validateReferences(channel: ChannelReference, tracks: TrackReference[]): Promise<void>;
}

// Read at operation time, not build/import time. Omitted configuration preserves
// existing deployments. Unsupported backends fail closed; there is no S3 fallback.
export function mediaStorageBackend(): "local" {
  const backend = process.env.V2_MEDIA_STORAGE_BACKEND ?? "local";
  if (backend !== "local") throw new UploadError("Unsupported V2 media storage backend.", 503);
  return backend;
}

export function canonicalMediaStorage(localRoot: string): CanonicalMediaStorage {
  switch (mediaStorageBackend()) {
    case "local": return localMediaStorage(localRoot);
  }
}
