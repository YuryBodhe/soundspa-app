import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { channels } from "../../db/v2/schema";
async function main() { const rows = await v2Db.select().from(channels).where(and(eq(channels.isPublished, true), isNull(channels.archivedAt))); let ok = 0; for (const channel of rows) { assert(channel.imageKey?.startsWith("covers/"), `legacy cover: ${channel.slug}`); const response = await fetch(`https://media.soundspa.bodhemusic.com/${channel.imageKey}`); assert.equal(response.status, 200, channel.slug); assert.equal(response.headers.get("content-type"), "image/jpeg", channel.slug); assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable", channel.slug); const bytes = Buffer.from(await response.arrayBuffer()); const hash = createHash("sha256").update(bytes).digest("hex"); assert.equal(hash, channel.imageKey.split("/").pop()!.slice(0, -4), channel.slug); console.info(JSON.stringify({ slug: channel.slug, key: channel.imageKey, bytes, sha256: hash })); ok++; } assert.equal(ok, 11); console.info(`ALL_PUBLISHED_COVERS_PASS ${ok}`); await v2Pool.end(); }
main().catch((error) => { console.error(error); process.exitCode = 1; });
