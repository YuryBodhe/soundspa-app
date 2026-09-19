import type { CanonicalMediaStorage } from "./canonicalMediaStorage";
import { localMediaStorage } from "./localMediaStorage";
import { s3MediaStorage, s3MediaStorageConfig } from "./s3MediaStorage";
import { UploadError } from "./uploadError";

export type MediaFinalizeMode = "local" | "s3-local" | "s3-only";
export type CanonicalMediaReceipt = {
  mode: "s3-local";
  key: string;
  size: number;
  sha256: string;
  s3Verified: boolean;
  localVerified: boolean;
} | {
  mode: "s3-only";
  key: string;
  size: number;
  sha256: string;
  s3Verified: boolean;
  localVerified?: boolean;
};
type CanonicalMediaPreparationReceipt = {
  mode: "s3-local" | "s3-only";
  key: string;
  size: number;
  sha256: string;
  s3Verified: boolean;
  localVerified: boolean;
};

export class CanonicalMediaPreparationError extends UploadError {
  constructor(message: string, readonly receipt: CanonicalMediaPreparationReceipt, readonly cause?: unknown) { super(message, cause instanceof UploadError ? cause.status : 503); }
}

export function mediaFinalizeMode(): MediaFinalizeMode {
  const mode = process.env.V2_MEDIA_FINALIZE_MODE ?? "local";
  if (mode !== "local" && mode !== "s3-local" && mode !== "s3-only") throw new UploadError("Unsupported V2 media finalize mode.", 503);
  return mode;
}

async function publishOrReconcile(storage: CanonicalMediaStorage, source: string, key: string, expected: { size: number; sha256: string }, conflict: string) {
  try { await storage.publishImmutable(source, key); }
  catch (error) {
    if (!storage.isAlreadyExistsError(error)) throw error;
    if (!await storage.matchesOwnedTrack(key, expected)) throw new UploadError(conflict, 409);
  }
  if (!await storage.matchesOwnedTrack(key, expected)) throw new UploadError("Canonical media verification failed.", 503);
}

export async function prepareResumableCanonicalMedia(
  localRoot: string,
  source: string,
  key: string,
  expected: { size: number; sha256: string },
  stores?: { s3: CanonicalMediaStorage; local: CanonicalMediaStorage },
) {
  const mode = mediaFinalizeMode();
  if (mode === "local") return undefined;
  const receipt: CanonicalMediaPreparationReceipt = { mode, key, ...expected, s3Verified: false, localVerified: false };
  const selected = stores ?? { s3: s3MediaStorage(localRoot, s3MediaStorageConfig()), local: localMediaStorage(localRoot) };
  try {
    await publishOrReconcile(selected.s3, source, key, expected, "Existing S3 object differs; operator review required.");
    receipt.s3Verified = true;
    if (mode === "s3-local") {
      await publishOrReconcile(selected.local, source, key, expected, "Existing local object differs; operator review required.");
      receipt.localVerified = true;
    }
    return receipt as CanonicalMediaReceipt;
  } catch (error) {
    throw new CanonicalMediaPreparationError(error instanceof Error ? error.message : "Canonical media preparation failed.", receipt, error);
  }
}
