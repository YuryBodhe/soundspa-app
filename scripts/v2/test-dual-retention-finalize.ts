import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalMediaStorage } from "../../lib/v2/canonicalMediaStorage";
import { CanonicalMediaPreparationError, mediaFinalizeMode, prepareResumableCanonicalMedia } from "../../lib/v2/resumableCanonicalMedia";

class AlreadyExists extends Error {}
function memoryStorage(name: string, order: string[]) {
  const objects = new Map<string, Buffer>();
  let fail: Error | undefined;
  const storage: CanonicalMediaStorage = {
    async publishImmutable(source, key) {
      order.push(`${name}:publish`);
      if (fail) throw fail;
      if (objects.has(key)) throw new AlreadyExists();
      objects.set(key, Buffer.from(await import("node:fs/promises").then(fs => fs.readFile(source))));
    },
    isAlreadyExistsError: error => error instanceof AlreadyExists,
    async size(key) { return objects.get(key)!.length; },
    async matchesOwnedTrack(key, expected) {
      order.push(`${name}:verify`);
      const bytes = objects.get(key); if (!bytes || (expected.size !== undefined && bytes.length !== expected.size)) return false;
      return createHash("sha256").update(bytes).digest("hex") === expected.sha256;
    },
    async inspectOwnedTrack(key) { return { missing: !objects.has(key) }; },
    async removeOwnedTrack() { throw new Error("deletion forbidden"); },
    async validateReferences() {},
  };
  return { storage, objects, setFailure(error?: Error) { fail = error; } };
}

async function main() {
  const previous = process.env.V2_MEDIA_FINALIZE_MODE;
  const root = await mkdtemp(join(tmpdir(), "soundspa-dual-retention-"));
  const source = join(root, "source.mp3");
  const bytes = Buffer.from("validated MP3 fixture bytes");
  const expected = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const key = "music/unit/immutable.mp3";
  await writeFile(source, bytes);
  try {
    delete process.env.V2_MEDIA_FINALIZE_MODE; assert.equal(mediaFinalizeMode(), "local");
    process.env.V2_MEDIA_FINALIZE_MODE = "invalid"; assert.throws(mediaFinalizeMode, /Unsupported/);
    process.env.V2_MEDIA_FINALIZE_MODE = "local";
    assert.equal(await prepareResumableCanonicalMedia(root, source, key, expected), undefined);

    process.env.V2_MEDIA_FINALIZE_MODE = "s3-local";
    let order: string[] = []; let s3 = memoryStorage("s3", order); let local = memoryStorage("local", order);
    const receipt = await prepareResumableCanonicalMedia(root, source, key, expected, { s3: s3.storage, local: local.storage });
    assert.deepEqual(order, ["s3:publish", "s3:verify", "local:publish", "local:verify"]);
    assert.deepEqual(receipt, { mode: "s3-local", key, ...expected, s3Verified: true, localVerified: true });

    // S3-only publishes and verifies the immutable remote object without a
    // permanent local canonical publication.
    process.env.V2_MEDIA_FINALIZE_MODE = "s3-only";
    order = []; s3 = memoryStorage("s3", order); local = memoryStorage("local", order);
    const s3Only = await prepareResumableCanonicalMedia(root, source, key, expected, { s3: s3.storage, local: local.storage });
    assert.deepEqual(order, ["s3:publish", "s3:verify"]);
    assert.deepEqual(s3Only, { mode: "s3-only", key, ...expected, s3Verified: true });
    assert.equal(local.objects.has(key), false);
    process.env.V2_MEDIA_FINALIZE_MODE = "s3-local";

    // Repeated finalize reconciles both immutable copies without overwriting.
    order = []; s3 = memoryStorage("s3", order); local = memoryStorage("local", order);
    s3.objects.set(key, bytes); local.objects.set(key, bytes);
    await prepareResumableCanonicalMedia(root, source, key, expected, { s3: s3.storage, local: local.storage });
    assert.deepEqual(order, ["s3:publish", "s3:verify", "s3:verify", "local:publish", "local:verify", "local:verify"]);

    // S3 failure stops before local publication and before any DB caller can run.
    order = []; s3 = memoryStorage("s3", order); local = memoryStorage("local", order); s3.setFailure(new Error("S3 unavailable"));
    await assert.rejects(prepareResumableCanonicalMedia(root, source, key, expected, { s3: s3.storage, local: local.storage }),
      (error: unknown) => error instanceof CanonicalMediaPreparationError && !error.receipt.s3Verified && !error.receipt.localVerified);
    assert.deepEqual(order, ["s3:publish"]); assert.equal(local.objects.size, 0);

    // S3 success plus local failure preserves the verified S3 receipt for retry.
    order = []; s3 = memoryStorage("s3", order); local = memoryStorage("local", order); local.setFailure(new Error("local retention failed"));
    await assert.rejects(prepareResumableCanonicalMedia(root, source, key, expected, { s3: s3.storage, local: local.storage }),
      (error: unknown) => error instanceof CanonicalMediaPreparationError && error.receipt.s3Verified && !error.receipt.localVerified);
    assert.deepEqual(s3.objects.get(key), bytes); assert.equal(local.objects.size, 0);

    // Different bytes at either layer are conflicts and are never overwritten.
    for (const conflictLayer of ["s3", "local"] as const) {
      order = []; s3 = memoryStorage("s3", order); local = memoryStorage("local", order);
      (conflictLayer === "s3" ? s3 : local).objects.set(key, Buffer.from("different"));
      if (conflictLayer === "local") s3.objects.set(key, bytes);
      await assert.rejects(prepareResumableCanonicalMedia(root, source, key, expected, { s3: s3.storage, local: local.storage }), new RegExp(`Existing ${conflictLayer === "s3" ? "S3" : "local"} object differs`));
      assert.deepEqual((conflictLayer === "s3" ? s3 : local).objects.get(key), Buffer.from("different"));
    }
    console.info("PASS: explicit finalize mode, S3-first ordering, dual verification, retry reconciliation, S3/local failure receipts, and collision preservation.");
  } finally {
    if (previous === undefined) delete process.env.V2_MEDIA_FINALIZE_MODE; else process.env.V2_MEDIA_FINALIZE_MODE = previous;
    await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
