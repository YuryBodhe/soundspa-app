import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { canonicalMediaStorage, mediaStorageBackend } from "../../lib/v2/canonicalMediaStorage";
import { receiveUpload, validateChannelReferences, UploadError } from "../../lib/v2/mediaStorage";
import { resolveMediaUrl, resolveImageUrl } from "../../app/v2/mediaUrls";

// Real filesystem tests only: no database, HTTP, credentials or staging writes.
async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "soundspa-local-backend-")));
  const previousBackend = process.env.V2_MEDIA_STORAGE_BACKEND;
  const previousRoot = process.env.V2_MEDIA_ROOT;
  process.env.V2_MEDIA_ROOT = root;
  try {
    delete process.env.V2_MEDIA_STORAGE_BACKEND;
    assert.equal(mediaStorageBackend(), "local");
    for (const backend of ["s3", "unknown", "", "LOCAL"]) {
      process.env.V2_MEDIA_STORAGE_BACKEND = backend;
      assert.throws(() => canonicalMediaStorage(root), error => error instanceof UploadError && error.status === 503);
    }
    process.env.V2_MEDIA_STORAGE_BACKEND = "local";
    assert.equal(mediaStorageBackend(), "local");
    const storage = canonicalMediaStorage(root);
    const data = Buffer.from("immutable canonical bytes");
    const hash = createHash("sha256").update(data).digest("hex");
    const source = join(root, "private-source");
    await writeFile(source, data);
    const key = "music/unit/one.mp3";
    await storage.publishImmutable(source, key);
    assert.equal((await stat(source)).ino, (await stat(join(root, key))).ino, "publication remains a hard link");
    assert.equal((await stat(join(root, key))).mode & 0o777, 0o644);
    assert.equal(await storage.size(key), data.length);
    assert.equal(await storage.matchesOwnedTrack(key, { size: data.length, sha256: hash }), true);
    assert.equal(await storage.matchesOwnedTrack(key, { size: data.length + 1, sha256: hash }), false);
    assert.equal(await storage.matchesOwnedTrack(key, { sha256: "0".repeat(64) }), false);
    assert.equal(await storage.matchesOwnedTrack("music/unit/missing.mp3", { sha256: hash }), false);
    const other = join(root, "other-source");
    await writeFile(other, "different bytes");
    await assert.rejects(storage.publishImmutable(other, key), storage.isAlreadyExistsError);
    await rm(source);
    assert.deepEqual(await readFile(join(root, key)), data, "cleanup/collision cannot change canonical bytes");

    const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#698475" } }).png().toBuffer();
    const image = await receiveUpload(new Request("http://local.test", {
      method: "POST", headers: { "X-Upload-Size": String(png.length) }, body: new Uint8Array(png),
    }), "artwork");
    assert.equal(image.sha256, createHash("sha256").update(png).digest("hex"), "source hash contract stays unchanged");
    await storage.publishImmutable(image.file, "artwork/first.jpg");
    await storage.publishImmutable(image.file, "artwork/second.jpg");
    await image.cleanup();
    assert.equal((await sharp(join(root, "artwork/first.jpg")).metadata()).format, "jpeg");
    const channel = { kind: "music" as const, imageKey: "artwork/second.jpg" };
    const tracks = [{ storageKey: key, sizeBytes: BigInt(data.length), isEnabled: true }];
    await validateChannelReferences(channel, tracks);
    await assert.rejects(validateChannelReferences(channel, [{ ...tracks[0], sizeBytes: BigInt(1) }]), /Cannot publish/);
    await assert.rejects(validateChannelReferences(channel, [{ ...tracks[0], storageKey: "music/unit/missing.mp3" }]), /Cannot publish/);
    await validateChannelReferences(channel, [{ ...tracks[0], storageKey: "music/unit/missing.mp3", isEnabled: false }]);
    await assert.rejects(validateChannelReferences({ ...channel, imageKey: null }, tracks), /Cannot publish/);
    await writeFile(join(root, "artwork/invalid.jpg"), "not an image");
    await assert.rejects(validateChannelReferences({ ...channel, imageKey: "artwork/invalid.jpg" }, tracks), /Cannot publish/);
    // Existing bundled artwork remains read-only; no fixture is written to public/.
    await validateChannelReferences({ ...channel, imageKey: "channel-1.jpg" }, tracks);

    await mkdir(join(root, "outside"));
    await writeFile(join(root, "outside/keep.mp3"), data);
    await symlink(join(root, "outside"), join(root, "music/linked"));
    await assert.rejects(storage.inspectOwnedTrack("music/linked/keep.mp3"), /Symlink/);
    await symlink(join(root, "outside/keep.mp3"), join(root, "music/unit/link.mp3"));
    await assert.rejects(storage.removeOwnedTrack("music/unit/link.mp3"), /regular track/);
    for (const unsafe of ["music/../outside/keep.mp3", "/outside/keep.mp3", "artwork/first.jpg"]) {
      await assert.rejects(storage.inspectOwnedTrack(unsafe), /Unsafe/);
    }
    assert.equal(await storage.removeOwnedTrack(key), "removed");
    assert.equal(await storage.removeOwnedTrack(key), "already-missing");
    assert.deepEqual(await storage.inspectOwnedTrack(key), { missing: true });
    assert.deepEqual(await readFile(join(root, "outside/keep.mp3")), data);
    assert.equal(resolveMediaUrl("music", key), "/music/unit/one.mp3");
    assert.equal(resolveMediaUrl("ambient", "ambient/unit/one.mp3"), "/noise/unit/one.mp3");
    assert.equal(resolveImageUrl("artwork/first.jpg"), "/artwork/first.jpg");
    console.info("PASS: local/default config, unsupported backend rejection, hard-link/no-overwrite, size/SHA-256, private cleanup, artwork/source hash, publish validation, bundled artwork, symlink/path rejection, delete/missing and unchanged delivery URLs.");
  } finally {
    if (previousBackend === undefined) delete process.env.V2_MEDIA_STORAGE_BACKEND;
    else process.env.V2_MEDIA_STORAGE_BACKEND = previousBackend;
    if (previousRoot === undefined) delete process.env.V2_MEDIA_ROOT;
    else process.env.V2_MEDIA_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
