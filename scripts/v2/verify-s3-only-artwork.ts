import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { channels } from "../../db/v2/schema";
import { mediaRoot } from "../../lib/v2/mediaStorage";

async function upload(origin: string, auth: string, channelId: string, bytes: Buffer, filename: string) {
  const response = await fetch(`${origin}/api/v2/admin/content/upload?channelId=${channelId}&kind=artwork`, { method: "POST", headers: { Authorization: auth, Origin: origin, "Content-Type": "application/octet-stream", "X-Upload-Filename": encodeURIComponent(filename), "X-Upload-Size": String(bytes.length) }, body: new Uint8Array(bytes) });
  const result = await response.json() as { key?: string; error?: string }; assert.equal(response.status, 201, result.error); assert(result.key); return result.key;
}
async function main() {
  const origin = process.env.V2_VERIFY_ORIGIN ?? "http://127.0.0.1:3000"; const delivery = process.env.V2_VERIFY_DELIVERY_ORIGIN ?? "https://media.soundspa.bodhemusic.com"; const user = process.env.V2_ADMIN_USERNAME; const password = process.env.V2_ADMIN_PASSWORD; assert(user && password); const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  const slug = `s3-only-cover-${randomUUID()}`; const [channel] = await v2Db.insert(channels).values({ slug, displayName: "S3-only cover verification", kind: "music", isPublished: false }).returning(); const root = await mediaRoot();
  try {
    const first = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#315b73" } }).png().toBuffer(); const second = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#9b6642" } }).png().toBuffer();
    const key1 = await upload(origin, auth, channel.id, first, "first.png"); assert.match(key1, new RegExp(`^covers/${channel.id}/[a-f0-9]{64}\\.jpg$`)); const key2 = await upload(origin, auth, channel.id, second, "second.png"); assert.match(key2, new RegExp(`^covers/${channel.id}/[a-f0-9]{64}\\.jpg$`)); assert.notEqual(key1, key2);
    const row = (await v2Db.select().from(channels).where(eq(channels.id, channel.id)))[0]; assert.equal(row.imageKey, key2); assert.equal(existsSync(join(root, key2)), false); assert.equal(existsSync(join(root, key1)), false);
    for (const key of [key1, key2]) { const response = await fetch(`${delivery}/${key}`); assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/jpeg"); assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable"); const body = Buffer.from(await response.arrayBuffer()); assert(body.length > 0); console.info(JSON.stringify({ key, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") })); }
    console.info("S3-only artwork verification PASS: immutable hash keys, replacement retention, CDN bytes/metadata, no local canonical copy.");
  } finally { await v2Db.delete(channels).where(eq(channels.id, channel.id)); await v2Pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
