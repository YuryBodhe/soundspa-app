import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { eq, and, isNull } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { channels } from "../../db/v2/schema";
import { mediaRoot } from "../../lib/v2/uploadWorkspace";
import { createS3Client, s3MediaStorage, s3MediaStorageConfig } from "../../lib/v2/s3MediaStorage";

async function bytes(body: unknown) { if (body && typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(); const chunks: Uint8Array[] = []; for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk); return Buffer.concat(chunks); }
async function main() {
  const root = await mediaRoot(); const config = s3MediaStorageConfig(); const client = createS3Client(config); const storage = s3MediaStorage(root, config, { client });
  const rows = await v2Db.select().from(channels).where(and(eq(channels.isPublished, true), isNull(channels.archivedAt)));
  for (const channel of rows) {
    assert(channel.imageKey, `Missing image key for ${channel.slug}`);
    if (channel.imageKey.startsWith("covers/")) { console.info(JSON.stringify({ slug: channel.slug, status: "already-cdn", key: channel.imageKey })); continue; }
    const source = channel.imageKey.startsWith("artwork/") ? join(root, channel.imageKey) : join(process.cwd(), "public", channel.imageKey);
    const content = await readFile(source); const sha256 = createHash("sha256").update(content).digest("hex"); const key = `covers/${channel.id}/${sha256}.jpg`;
    await storage.publishImmutable(source, key);
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    assert.equal(head.ContentLength, content.byteLength); assert.equal(head.ContentType, "image/jpeg"); assert.equal(head.CacheControl, "public, max-age=31536000, immutable"); assert.equal(head.Metadata?.sha256, sha256);
    const remote = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key })); const downloaded = await bytes(remote.Body); assert.equal(createHash("sha256").update(downloaded).digest("hex"), sha256);
    await v2Db.update(channels).set({ imageKey: key, updatedAt: new Date() }).where(eq(channels.id, channel.id));
    console.info(JSON.stringify({ slug: channel.slug, channelId: channel.id, oldKey: channel.imageKey, key, size: content.byteLength, sha256 }));
  }
}
main().finally(() => v2Pool.end()).catch((error) => { console.error(error); process.exitCode = 1; });
