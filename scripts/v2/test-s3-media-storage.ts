import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3MediaStorage, S3ObjectAlreadyExistsError } from "../../lib/v2/s3MediaStorage";

type Stored = { bytes: Buffer; contentType?: string; cacheControl?: string; metadata?: Record<string, string> };
class FakeS3 {
  objects = new Map<string, Stored>();
  failAfterPut = false;
  async send(command: PutObjectCommand | HeadObjectCommand | GetObjectCommand | DeleteObjectCommand) {
    const value = command.input as { Key?: string; Body?: Uint8Array; IfNoneMatch?: string; ContentType?: string; CacheControl?: string; Metadata?: Record<string, string> };
    const key = value.Key!;
    if (command instanceof PutObjectCommand) {
      assert.equal(value.IfNoneMatch, "*");
      if (this.objects.has(key)) throw Object.assign(new Error("precondition"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      this.objects.set(key, { bytes: Buffer.from(value.Body!), contentType: value.ContentType, cacheControl: value.CacheControl, metadata: value.Metadata });
      if (this.failAfterPut) { this.failAfterPut = false; throw new Error("lost response"); }
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.bytes.length, ContentType: object.contentType, CacheControl: object.cacheControl, Metadata: object.metadata };
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { Body: { transformToByteArray: async () => object.bytes } };
    }
    if (command instanceof DeleteObjectCommand) { this.objects.delete(key); return {}; }
    throw new Error("Unexpected command");
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "soundspa-s3-adapter-"));
  const source = join(root, "source.mp3");
  const bytes = Buffer.from("isolated immutable S3 bytes");
  await writeFile(source, bytes);
  const fake = new FakeS3();
  const config = { endpoint: "https://s3.invalid", bucket: "test", region: "test-1", accessKeyId: "test", secretAccessKey: "test" };
  const storage = s3MediaStorage(root, config, { client: fake as never });
  const key = "music/unit/one.mp3";
  try {
    await storage.publishImmutable(source, key);
    assert.equal(await storage.size(key), bytes.length);
    assert.deepEqual(await storage.inspectOwnedTrack(key), { missing: false });
    assert.equal(await storage.matchesOwnedTrack(key, { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }), true);
    assert.equal(await storage.matchesOwnedTrack(key, { sha256: "0".repeat(64) }), false);
    assert.equal(fake.objects.get(key)?.contentType, "audio/mpeg");
    assert.equal(fake.objects.get(key)?.cacheControl, "public, max-age=2592000");
    await assert.rejects(storage.publishImmutable(source, key), error => error instanceof S3ObjectAlreadyExistsError && storage.isAlreadyExistsError(error));
    assert.deepEqual(fake.objects.get(key)?.bytes, bytes);
    await assert.rejects(storage.removeOwnedTrack(key), /deletion is disabled/);

    const recoveredKey = "ambient/unit/recovered.mp3";
    fake.failAfterPut = true;
    await storage.publishImmutable(source, recoveredKey);
    assert.deepEqual(fake.objects.get(recoveredKey)?.bytes, bytes, "ambiguous committed PUT is reconciled by full content hash");

    const cleanup = s3MediaStorage(root, config, { client: fake as never, allowDelete: true, deletePrefix: "__soundspa_test__/", testPrefix: "__soundspa_test__/run/" });
    const testKey = "__soundspa_test__/run/music/unit/cleanup.mp3";
    await cleanup.publishImmutable(source, testKey);
    assert.equal(await cleanup.removeOwnedTrack(testKey), "removed");
    assert.equal(await cleanup.removeOwnedTrack(testKey), "already-missing");
    console.info("PASS: conditional PUT, collision preservation, metadata, size/SHA-256 inspection, ambiguous PUT reconciliation, and test-prefix-only deletion.");
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
