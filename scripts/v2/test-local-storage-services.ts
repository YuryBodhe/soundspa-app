import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import sharp from "sharp";
import { canonicalMediaStorage } from "../../lib/v2/canonicalMediaStorage";
import { receiveUpload } from "../../lib/v2/mediaStorage";

// Exercise the real services and real local storage, replacing only the DB
// connection with transactional rows in memory. No PostgreSQL/SSH/HTTP writes.
type Row = Record<string, unknown>;
type Projection = Record<string, { name: string }>;
const dialect = new PgDialect();
const property = (column: string) => column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const tables = new Map<string, Row[]>([["channels", []], ["channel_tracks", []]]);
let failCommit = false;
const rows = (table: Table) => tables.get(getTableName(table))!;
const matches = (condition: SQL) => {
  const query = dialect.sqlToQuery(condition);
  const match = query.sql.match(/^"[^" ]+"\."([^" ]+)" = \$1$/);
  assert(match, `Unexpected test query: ${query.sql}`);
  return (row: Row) => row[property(match[1])] === query.params[0];
};
const project = (row: Row, fields?: Projection) => fields
  ? Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[property(column.name)]]))
  : { ...row };
const connection = {
  async transaction<T>(fn: (tx: object) => Promise<T>): Promise<T> {
    const before = structuredClone(tables);
    try {
      const result = await fn(connection);
      if (failCommit) throw new Error("simulated commit failure");
      return result;
    } catch (error) {
      tables.clear(); for (const [key, value] of before) tables.set(key, value);
      throw error;
    }
  },
  async execute() { return { rows: [] }; }, // Channel lock; no concurrency simulation.
  select(fields?: Projection) {
    return { from: (table: Table) => ({ where: async (condition: SQL) => rows(table).filter(matches(condition)).map(row => project(row, fields)) }) };
  },
  insert(table: Table) {
    return { values: (value: Row) => ({ returning: async (fields?: Projection) => {
      const row: Row = { id: randomUUID(), ...value };
      assert(!rows(table).some(old => old.id === row.id || old.storageKey === row.storageKey));
      rows(table).push(row); return [project(row, fields)];
    } }) };
  },
  update(table: Table) {
    return { set: (value: Row) => ({ where: async (condition: SQL) => { rows(table).filter(matches(condition)).forEach(row => Object.assign(row, value)); } }) };
  },
  delete(table: Table) {
    return { where: async (condition: SQL) => { tables.set(getTableName(table), rows(table).filter(row => !matches(condition)(row))); } };
  },
};

async function main() {
  process.env.V2_DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/soundspa_v2";
  process.env.V2_MEDIA_STORAGE_BACKEND = "local";
  const { v2Db, v2Pool } = await import("../../db/v2/client");
  // Any accidental real DB request fails immediately.
  Object.assign(v2Pool, { query: () => { throw new Error("Real database access forbidden in this test"); }, connect: () => { throw new Error("Real database access forbidden in this test"); } });
  const originalTransaction = v2Db.transaction;
  const originalSelect = v2Db.select;
  Object.assign(v2Db, { transaction: connection.transaction, select: connection.select });
  const { attachContentUpload } = await import("../../db/v2/services/contentUpload");
  const { deleteContentTrack, cleanupDeletedTrack } = await import("../../db/v2/services/contentDelete");
  const { contentAdminService } = await import("../../db/v2/services/contentAdmin");
  const root = await realpath(await mkdtemp(join(tmpdir(), "soundspa-local-services-")));
  process.env.V2_MEDIA_ROOT = root;
  const storage = canonicalMediaStorage(root);
  try {
    await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-codec:a", "libmp3lame", join(root, "fixture.mp3")]);
    const bytes = await readFile(join(root, "fixture.mp3"));
    const request = (data: Buffer) => new Request("http://test.invalid", { method: "POST", headers: { "X-Upload-Size": String(data.length) }, body: new Uint8Array(data) });
    const upload = await receiveUpload(request(bytes), "track");
    const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#698475" } }).png().toBuffer();
    const artwork = await receiveUpload(request(png), "artwork");
    for (const kind of ["music", "ambient"] as const) {
      const channelId = randomUUID();
      tables.get("channels")!.push({ id: channelId, slug: kind, kind, archivedAt: null, isPublished: false, imageKey: null });
      const makeIdentity = () => { const id = randomUUID(); return { id, key: `${kind}/${kind}/${id}.mp3` }; };
      const first = makeIdentity();
      const attached = await attachContentUpload(channelId, "track", upload, "Original.mp3", first);
      assert.deepEqual(attached, { key: first.key, trackId: first.id });
      assert.deepEqual(await attachContentUpload(channelId, "track", upload, "Original.mp3", first), attached);
      assert.equal(tables.get("channel_tracks")!.filter(row => row.id === first.id).length, 1);
      await assert.rejects(attachContentUpload(channelId, "track", { ...upload, sha256: "0".repeat(64) }, "Original.mp3", first), /Committed upload media mismatch/);
      await assert.rejects(attachContentUpload(channelId, "track", upload, "Different.mp3", first), /identity conflict/);

      const recovered = makeIdentity();
      await storage.publishImmutable(upload.file, recovered.key); // Crash after publication, before DB commit.
      await attachContentUpload(channelId, "track", upload, "Recovered.mp3", recovered);
      const collision = makeIdentity();
      const different = join(root, "different-source"); await writeFile(different, "different");
      await storage.publishImmutable(different, collision.key);
      await assert.rejects(attachContentUpload(channelId, "track", upload, "Collision.mp3", collision), /Existing upload object differs/);
      assert(!tables.get("channel_tracks")!.some(row => row.id === collision.id));
      assert.equal((await readFile(join(root, collision.key))).toString(), "different");

      const prepared = makeIdentity();
      await storage.publishImmutable(upload.file, prepared.key);
      const canonicalReceipt = { mode: "s3-local" as const, key: prepared.key, size: upload.size, sha256: upload.sha256, s3Verified: true, localVerified: true };
      failCommit = true;
      await assert.rejects(attachContentUpload(channelId, "track", upload, "Prepared.mp3", prepared, canonicalReceipt), /orphan review/);
      failCommit = false;
      assert(!tables.get("channel_tracks")!.some(row => row.id === prepared.id));
      assert.deepEqual(await readFile(join(root, prepared.key)), bytes, "DB failure retains prepared canonical media");
      await attachContentUpload(channelId, "track", upload, "Prepared.mp3", prepared, canonicalReceipt);
      assert(tables.get("channel_tracks")!.some(row => row.id === prepared.id));

      const a = await attachContentUpload(channelId, "artwork", artwork, "first.png");
      const b = await attachContentUpload(channelId, "artwork", artwork, "second.png");
      assert.notEqual(a.key, b.key);
      assert((await readFile(join(root, a.key))).length > 0);
      assert.equal(tables.get("channels")!.find(row => row.id === channelId)!.imageKey, b.key);
      const service = contentAdminService(connection as unknown as Parameters<typeof contentAdminService>[0]);
      await service.publication(channelId, true);
      assert.equal(tables.get("channels")!.find(row => row.id === channelId)!.isPublished, true);
      assert.match(await deleteContentTrack(prepared.id), /permanently deleted/);

      const track = tables.get("channel_tracks")!.find(row => row.id === first.id)!;
      assert.match(await cleanupDeletedTrack(track as never, root, async () => true), /another track/);
      assert.match(await cleanupDeletedTrack(track as never, root, async () => { throw new Error("reference query unavailable"); }), /cleanup failed/);
      assert.deepEqual(await readFile(join(root, first.key)), bytes);
      failCommit = true;
      await assert.rejects(deleteContentTrack(first.id), /commit failure/);
      failCommit = false;
      assert(tables.get("channel_tracks")!.some(row => row.id === first.id));
      assert.deepEqual(await readFile(join(root, first.key)), bytes, "failed commit must never unlink");
      assert.match(await deleteContentTrack(first.id), /permanently deleted/);
      await assert.rejects(readFile(join(root, first.key)), { code: "ENOENT" });
      await assert.rejects(deleteContentTrack(recovered.id), /last enabled/);
      await service.publication(channelId, false);
      await rm(join(root, recovered.key));
      assert.match(await deleteContentTrack(recovered.id), /already missing/);
      await assert.rejects(deleteContentTrack(randomUUID()), /not found/);

      const orphan = makeIdentity();
      failCommit = true;
      await assert.rejects(attachContentUpload(channelId, "track", upload, "Orphan.mp3", orphan), /orphan review/);
      failCommit = false;
      assert(!tables.get("channel_tracks")!.some(row => row.id === orphan.id));
      assert.deepEqual(await readFile(join(root, orphan.key)), bytes);
      assert((await readFile(join(root, ".uploads/orphans.ndjson"), "utf8")).includes(orphan.key));
      await attachContentUpload(channelId, "track", upload, "Orphan.mp3", orphan);
      assert(tables.get("channel_tracks")!.some(row => row.id === orphan.id));
    }
    await upload.cleanup(); await artwork.cleanup();
    console.info("PASS: real upload/publish/delete services with in-memory transactions; music+ambient identity/key preservation, repeated finalize, prepublished recovery, mismatched hashes, artwork replacement, reference publication, DB-failure orphan retention, retry recovery, DB-before-unlink, last-track protection, missing-file and cleanup-failure behavior. No real DB accessed.");
  } finally {
    Object.assign(v2Db, { transaction: originalTransaction, select: originalSelect });
    await v2Pool.end();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
