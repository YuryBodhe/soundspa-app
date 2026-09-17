import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, s3MediaStorage, s3MediaStorageConfig } from "../../lib/v2/s3MediaStorage";

async function main() {
  const config = s3MediaStorageConfig();
  const run = randomUUID();
  const prefix = `__soundspa_test__/${run}/`;
  const key = `${prefix}music/compatibility/test.mp3`;
  const root = await mkdtemp(join(tmpdir(), "soundspa-timeweb-s3-"));
  const source = join(root, "test.mp3");
  const conflicting = join(root, "conflict.mp3");
  const bytes = Buffer.from(`SoundSpa isolated Timeweb compatibility object ${run}`);
  await writeFile(source, bytes); await writeFile(conflicting, Buffer.from("different collision bytes"));
  const client = createS3Client(config);
  const storage = s3MediaStorage(root, config, { client, allowDelete: true, deletePrefix: prefix, testPrefix: prefix });
  let created = false;
  try {
    await storage.publishImmutable(source, key); created = true;
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    assert.equal(head.ContentLength, bytes.length);
    assert.equal(head.ContentType, "audio/mpeg");
    assert.equal(head.CacheControl, "public, max-age=2592000");
    assert.equal(await storage.matchesOwnedTrack(key, { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }), true);
    await assert.rejects(storage.publishImmutable(conflicting, key), storage.isAlreadyExistsError);
    assert.equal(await storage.matchesOwnedTrack(key, { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }), true);
    const range = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key, Range: "bytes=0-9" }));
    assert.equal(range.$metadata.httpStatusCode, 206); assert.equal(range.ContentRange, `bytes 0-9/${bytes.length}`);
    const ranged = await range.Body!.transformToByteArray(); assert.deepEqual(Buffer.from(ranged), bytes.subarray(0, 10));
    console.info(JSON.stringify({ ok: true, endpoint: config.endpoint, bucket: config.bucket, region: config.region,
      addressingStyle: config.forcePathStyle ? "path" : "virtual-host", conditionalPut: true, collisionPreserved: true,
      contentType: head.ContentType, cacheControl: head.CacheControl, size: head.ContentLength, sha256Verified: true, range206: true, key }));
  } finally {
    if (created) assert.equal(await storage.removeOwnedTrack(key), "removed");
    await client.destroy(); await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
