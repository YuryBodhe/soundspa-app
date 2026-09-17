import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Client } from "pg";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, s3MediaStorage, s3MediaStorageConfig } from "../../lib/v2/s3MediaStorage";

type Track = { id: string; storage_key: string; original_filename: string; size_bytes: string; is_enabled: boolean };
type Candidate = Track & { local_path: string; local_size?: number; local_sha256?: string; classification: "already-correct" | "missing" | "conflict/error"; error?: string };

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(root: string, db: Client, storage: ReturnType<typeof s3MediaStorage>): Promise<Candidate[]> {
  const { rows } = await db.query<Track>("select id,storage_key,original_filename,size_bytes::text,is_enabled from channel_tracks order by id");
  const result: Candidate[] = [];
  for (const track of rows) {
    const localPath = resolve(root, track.storage_key);
    const candidate: Candidate = { ...track, local_path: localPath, classification: "conflict/error" };
    try {
      const canonicalRoot = await realpath(root);
      if (!localPath.startsWith(canonicalRoot + sep)) throw new Error("local path escapes media root");
      const info = await stat(localPath);
      candidate.local_size = info.size;
      candidate.local_sha256 = await hashFile(localPath);
      if (info.size !== Number(track.size_bytes)) throw new Error(`DB/local size mismatch (${track.size_bytes}/${info.size})`);
      const expected = { size: info.size, sha256: candidate.local_sha256 };
      const owned = await storage.inspectOwnedTrack(track.storage_key);
      if (owned.missing) candidate.classification = "missing";
      else if (await storage.matchesOwnedTrack(track.storage_key, expected)) candidate.classification = "already-correct";
      else candidate.error = "Existing S3 object differs in size, SHA-256 metadata, or full content.";
    } catch (error) { candidate.error = error instanceof Error ? error.message : "inspection failed"; }
    result.push(candidate);
  }
  return result;
}

function summary(candidates: Candidate[]) {
  const bySha = new Map<string, string[]>();
  for (const candidate of candidates) {
    if (!candidate.local_sha256) continue;
    bySha.set(candidate.local_sha256, [...(bySha.get(candidate.local_sha256) ?? []), candidate.storage_key]);
  }
  return {
    total: candidates.length,
    alreadyCorrect: candidates.filter(c => c.classification === "already-correct").length,
    missing: candidates.filter(c => c.classification === "missing").length,
    conflictsOrErrors: candidates.filter(c => c.classification === "conflict/error").length,
    enabled: candidates.filter(c => c.is_enabled).length,
    disabled: candidates.filter(c => !c.is_enabled).length,
    duplicateContentDifferentKeys: [...bySha.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([sha256, storageKeys]) => ({ sha256, storageKeys })),
  };
}

async function canary(root: string, db: Client, candidates: Candidate[], canaryId: string) {
  const target = candidates.find(candidate => candidate.id === canaryId);
  if (!target) throw new Error("Canary track ID is not in the DB inventory.");
  if (target.storage_key === "music/spaquatoria/df64a70f-dc73-4792-80e7-073bae041968.mp3") throw new Error("The already dual-retained Step-2B track cannot be the canary.");
  if (target.classification !== "missing") throw new Error(`Canary must be S3-missing after dry-run; observed ${target.classification}.`);
  assert(target.local_sha256 && target.local_size !== undefined);
  const config = s3MediaStorageConfig();
  const client = createS3Client(config);
  const storage = s3MediaStorage(root, config);
  await storage.publishImmutable(target.local_path, target.storage_key);
  assert.equal(await storage.matchesOwnedTrack(target.storage_key, { size: target.local_size, sha256: target.local_sha256 }), true);
  const input = { Bucket: config.bucket, Key: target.storage_key };
  const head = await client.send(new HeadObjectCommand(input));
  const full = await client.send(new GetObjectCommand(input));
  const fullBytes = Buffer.from(await full.Body!.transformToByteArray());
  const fullSha = createHash("sha256").update(fullBytes).digest("hex");
  const range = await client.send(new GetObjectCommand({ ...input, Range: "bytes=0-99" }));
  const rangeBytes = Buffer.from(await range.Body!.transformToByteArray());
  const result = { id: target.id, storage_key: target.storage_key, size: target.local_size, sha256: target.local_sha256,
    s3: { size: head.ContentLength, metadata: head.Metadata, contentType: head.ContentType, cacheControl: head.CacheControl,
      fullGetStatus: full.$metadata.httpStatusCode, fullGetBytes: fullBytes.length, fullSha256: fullSha,
      rangeStatus: range.$metadata.httpStatusCode, contentRange: range.ContentRange, rangeBytes: rangeBytes.length },
    verified: target.local_size === head.ContentLength && target.local_sha256 === fullSha && head.Metadata?.sha256 === fullSha &&
      head.ContentType === "audio/mpeg" && head.CacheControl === "public, max-age=2592000" && range.$metadata.httpStatusCode === 206 };
  await client.destroy();
  if (!result.verified) throw new Error(`Canary verification failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
}

async function main() {
  const mode = process.argv[2] ?? "--dry-run";
  if (mode !== "--dry-run" && mode !== "--canary") throw new Error("Usage: --dry-run | --canary <track-id>");
  const canaryId = mode === "--canary" ? process.argv[3] : undefined;
  if (mode === "--canary" && !canaryId) throw new Error("--canary requires a track ID.");
  const root = process.env.V2_MEDIA_ROOT ?? "/var/lib/soundspa-v2-media";
  const db = new Client({ connectionString: process.env.V2_DATABASE_URL });
  await db.connect();
  try {
    const config = s3MediaStorageConfig();
    const storage = s3MediaStorage(root, config);
    const candidates = await inventory(root, db, storage);
    const state = summary(candidates);
    console.log(JSON.stringify({ mode, state, candidates }));
    if (state.total !== 31 || state.conflictsOrErrors !== 0) throw new Error("Dry-run consistency gate failed; no migration was performed.");
    if (mode === "--canary") await canary(root, db, candidates, canaryId!);
  } finally { await db.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "migration failed"); process.exitCode = 1; });
