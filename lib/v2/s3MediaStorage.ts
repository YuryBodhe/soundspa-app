import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { CanonicalMediaStorage, ChannelReference, TrackReference } from "./canonicalMediaStorage";
import { localMediaStorage } from "./localMediaStorage";
import { UploadError } from "./uploadError";

const TRACK_KEY = /^(music|ambient)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.mp3$/;

export class S3ObjectAlreadyExistsError extends UploadError {
  readonly code = "S3_OBJECT_ALREADY_EXISTS";
  constructor() { super("Canonical media object already exists.", 409); }
}

export type S3MediaStorageConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

type S3Sender = Pick<S3Client, "send">;
type S3MediaStorageOptions = { client?: S3Sender; allowDelete?: boolean; deletePrefix?: string; testPrefix?: string };

function required(name: keyof NodeJS.ProcessEnv) {
  const value = process.env[name];
  if (!value) throw new UploadError(`Missing server-only S3 configuration: ${name}.`, 503);
  return value;
}

export function s3MediaStorageConfig(): S3MediaStorageConfig {
  const pathStyle = process.env.V2_S3_FORCE_PATH_STYLE;
  if (pathStyle !== undefined && pathStyle !== "0" && pathStyle !== "1") throw new UploadError("V2_S3_FORCE_PATH_STYLE must be 0 or 1.", 503);
  return {
    endpoint: required("V2_S3_ENDPOINT"), bucket: required("V2_S3_BUCKET"), region: required("V2_S3_REGION"),
    accessKeyId: required("V2_S3_ACCESS_KEY_ID"), secretAccessKey: required("V2_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: pathStyle === "1",
  };
}

export function createS3Client(config: S3MediaStorageConfig) {
  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint, region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: config.forcePathStyle ?? false, maxAttempts: 3,
  };
  return new S3Client(clientConfig);
}

function validateTrackKey(key: string, testPrefix?: string) {
  const candidate = testPrefix && key.startsWith(testPrefix) ? key.slice(testPrefix.length) : key;
  if (!TRACK_KEY.test(candidate) || key.split("/").some(part => !part || part === "." || part === "..")) throw new UploadError("Unsafe track storage key.");
}
const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const isNotFound = (error: unknown) => status(error) === 404 || (error as { name?: string })?.name === "NotFound";
const isPreconditionFailed = (error: unknown) => status(error) === 412 || (error as { name?: string })?.name === "PreconditionFailed";

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body && typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function s3MediaStorage(localRoot: string, config: S3MediaStorageConfig, options: S3MediaStorageOptions = {}): CanonicalMediaStorage {
  const client = options.client ?? createS3Client(config);
  const local = localMediaStorage(localRoot);
  const input = (key: string) => ({ Bucket: config.bucket, Key: key });
  async function remoteBytes(key: string) {
    const result = await client.send(new GetObjectCommand(input(key)));
    if (!result.Body) throw new UploadError("S3 object response has no body.", 503);
    return bodyBytes(result.Body);
  }
  async function matches(key: string, expected: { size?: number; sha256: string }) {
    validateTrackKey(key, options.testPrefix);
    try {
      const head = await client.send(new HeadObjectCommand(input(key)));
      if (expected.size !== undefined && head.ContentLength !== expected.size) return false;
      const bytes = await remoteBytes(key);
      if (expected.size !== undefined && bytes.byteLength !== expected.size) return false;
      return createHash("sha256").update(bytes).digest("hex") === expected.sha256;
    } catch (error) { if (isNotFound(error)) return false; throw error; }
  }
  return {
    async publishImmutable(source, key) {
      if (key.startsWith("artwork/")) return local.publishImmutable(source, key);
      validateTrackKey(key, options.testPrefix);
      const bytes = await readFile(source);
      const expected = { size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
      try {
        await client.send(new PutObjectCommand({ ...input(key), Body: bytes, IfNoneMatch: "*", ContentType: "audio/mpeg",
          CacheControl: "public, max-age=2592000", Metadata: { sha256: expected.sha256 } }));
      } catch (error) {
        if (isPreconditionFailed(error)) throw new S3ObjectAlreadyExistsError();
        try { if (await matches(key, expected)) return; } catch { /* preserve the original ambiguous PUT error */ }
        throw error;
      }
    },
    isAlreadyExistsError: error => error instanceof S3ObjectAlreadyExistsError,
    async size(key) {
      if (key.startsWith("artwork/")) return local.size(key);
      validateTrackKey(key, options.testPrefix);
      try {
        const result = await client.send(new HeadObjectCommand(input(key)));
        if (result.ContentLength === undefined) throw new UploadError("S3 object size is unavailable.", 503);
        return result.ContentLength;
      } catch (error) { if (isNotFound(error)) throw new UploadError("Canonical media object is missing.", 404); throw error; }
    },
    matchesOwnedTrack: matches,
    async inspectOwnedTrack(key) {
      validateTrackKey(key, options.testPrefix);
      try { await client.send(new HeadObjectCommand(input(key))); return { missing: false }; }
      catch (error) { if (isNotFound(error)) return { missing: true }; throw error; }
    },
    async removeOwnedTrack(key) {
      validateTrackKey(key, options.testPrefix);
      if (!options.allowDelete || (options.deletePrefix && !key.startsWith(options.deletePrefix))) throw new UploadError("S3 object deletion is disabled.", 503);
      const inspected = await this.inspectOwnedTrack(key);
      if (inspected.missing) return "already-missing";
      await client.send(new DeleteObjectCommand(input(key)));
      return "removed";
    },
    async validateReferences(channel: ChannelReference, tracks: TrackReference[]) {
      await local.validateReferences(channel, []);
      try {
        for (const track of tracks.filter(track => track.isEnabled)) {
          validateTrackKey(track.storageKey, options.testPrefix);
          const result = await client.send(new HeadObjectCommand(input(track.storageKey)));
          if (result.ContentLength === undefined || BigInt(result.ContentLength) !== track.sizeBytes) throw new Error("Size mismatch");
        }
      } catch { throw new UploadError("Cannot publish: artwork or enabled track media is missing, invalid, or has an unexpected size."); }
    },
  };
}
