// Frozen first revisions of existing media. Never replace bytes behind these
// keys: a replacement requires a new key/track and disabling the previous track.
// No application deployment required; run explicitly with a read-only media mount.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { sql } from "drizzle-orm";

const catalog = [
  { slug: "divnitsa", displayName: "Divnitsa", kind: "music", imageKey: "channel-divnitsa_v2.jpg", sortOrder: 0 },
  { slug: "relax", displayName: "Relax", kind: "music", imageKey: "channel-1.jpg", sortOrder: 1 },
  { slug: "432", displayName: "432 Hz", kind: "music", imageKey: "channel-432.jpg", sortOrder: 2 },
  { slug: "forest", displayName: "Forest", kind: "ambient", imageKey: "noise-forest.jpg", sortOrder: 0 },
  { slug: "night", displayName: "Night", kind: "ambient", imageKey: "noise-night.jpg", sortOrder: 1 },
  { slug: "sea", displayName: "Sea", kind: "ambient", imageKey: "noise-sea.jpg", sortOrder: 2 },
] as const;
const media = [
  ["divnitsa", "music/divnitsa/divnitsa-mix-01.mp3", 29605221, 0, "2fda8ed61385cf2c755efed1e93cafc1b9b6525c5d4e6c80117f905bc63dc2a9"],
  ["divnitsa", "music/divnitsa/divnitsa-mix-02.mp3", 33013260, 1, "526f8e2b8073c6ce5c10ea11440c0bb88ea89591b5656791dfb2bc702a80fa0d"],
  ["divnitsa", "music/divnitsa/divnitsa-mix-03.mp3", 31045090, 2, "7d25b1b4093c92cbed555fc04aa0de1a45872d0c57a13e46a028f1d7abe6739b"],
  ["relax", "music/relax/relax-mix-01.mp3", 28997090, 0, "87d01769bfad5a8417807ca20d9eb855b84a1e32645763db0d775bb80cb17f0f"],
  ["432", "music/432/432-mix-01.mp3", 26357260, 0, "0f3046121e13d636fbb24856067ed03c0411b8eb1b20d24bc4c872f1d65d52f8"],
  ["forest", "ambient/forest.mp3", 4311424, 0, "8cbe3d21f836afb5dc9fa2c2baeae15959754dfd3de3c0d3b68b6013690564da"],
  ["night", "ambient/night.mp3", 3716992, 0, "7d402ddf9752fc2867700de1a396941bc51fdea8b744b331be6de031eceb23c3"],
  ["sea", "ambient/sea.mp3", 1796992, 0, "675e5e59325fd31e5e3f69b6e9e83b00ab60013d93adf575e6370a45e11d4c6c"],
] as const;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--plan") {
    console.info({ catalog, media }); return;
  }
  assert(args.length === 2 || (args.length === 3 && args[2] === "--check-media-only"), "Use --media-root <directory> [--check-media-only]");
  assert.equal(args[0], "--media-root");
  const root = await realpath(args[1]);
  for (const [, key, expectedSize, , expectedHash] of media) {
    const file = await realpath(resolve(root, key));
    assert(file.startsWith(root + sep), `Media escapes root: ${key}`);
    const info = await stat(file);
    assert(info.isFile() && info.size > 0, `Invalid media: ${key}`);
    assert.equal(info.size, expectedSize, `Size discrepancy: ${key}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    assert.equal(hash.digest("hex"), expectedHash, `Immutable bytes changed: ${key}`);
  }
  console.info("Media verification PASS: 8 exact sizes/SHA-256; no files modified.");
  if (args[2] === "--check-media-only") return;
  // Lazy import: media-only/plan mode never creates a DB client.
  const { v2Db, v2Pool } = await import("../../db/v2/client");
  const { channels, channelTracks } = await import("../../db/v2/schema");
  try {
    const result = await v2Db.transaction(async (tx) => {
      const target = await tx.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
      assert.deepEqual(target.rows[0], { database: "soundspa_v2", user: "soundspa_v2" });
      const invariants = async () => (await tx.execute(sql`SELECT
        (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS migrations,
        (SELECT count(*)::int FROM location_service_access) AS service,
        (SELECT count(*)::int FROM location_channel_entitlements) AS entitlements`)).rows[0];
      const before = await invariants(); assert.equal(before.migrations, 3);
      const existingChannels = await tx.select().from(channels);
      const existingTracks = await tx.select().from(channelTracks);
      for (const row of existingChannels) assert(catalog.some((c) => c.slug === row.slug), `Unexpected existing channel: ${row.slug}`);
      for (const row of existingTracks) assert(media.some((m) => m[1] === row.storageKey), `Unexpected existing track: ${row.storageKey}`);
      let insertedChannels = 0; let insertedTracks = 0;
      const channelIds = new Map<string, string>();
      for (const expected of catalog) {
        let row = existingChannels.find((c) => c.slug === expected.slug);
        const values = { ...expected, description: null, isPublished: true, archivedAt: null };
        if (row) {
          for (const [key, value] of Object.entries(values)) assert.equal(row[key as keyof typeof row], value, `Channel conflict: ${expected.slug}.${key}`);
        } else {
          [row] = await tx.insert(channels).values(values).returning(); insertedChannels++;
        }
        channelIds.set(expected.slug, row.id);
      }
      for (const [slug, storageKey, size, sortOrder] of media) {
        const values = { channelId: channelIds.get(slug)!, storageKey, originalFilename: basename(storageKey), sizeBytes: BigInt(size), sortOrder, isEnabled: true };
        const row = existingTracks.find((t) => t.storageKey === storageKey);
        if (row) {
          for (const [key, value] of Object.entries(values)) assert.equal(row[key as keyof typeof row], value, `Track conflict: ${storageKey}.${key}`);
        } else { await tx.insert(channelTracks).values(values); insertedTracks++; }
      }
      assert.equal((await tx.select().from(channels)).length, 6);
      assert.equal((await tx.select().from(channelTracks)).length, 8);
      assert.deepEqual(await invariants(), before);
      return { insertedChannels, insertedTracks, updates: 0, channels: 6, tracks: 8, ...before };
    }, { isolationLevel: "serializable" });
    console.info("Content seed PASS:", result);
  } finally { await v2Pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
