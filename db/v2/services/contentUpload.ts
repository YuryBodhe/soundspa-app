import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { v2Db } from "../client";
import { channels, channelTracks } from "../schema";
import { publishImmutable, recordOrphan, UploadError } from "../../../lib/v2/mediaStorage";

export async function attachContentUpload(channelId: string, kind: "track"|"artwork", upload: {root:string;file:string;extension:string;size:number}, originalFilename: string) {
  z.string().uuid().parse(channelId);
  let createdKey: string | null = null;
  try {
    return await v2Db.transaction(async(tx)=>{
      await tx.execute(sql`SELECT id FROM channels WHERE id=${channelId}::uuid FOR UPDATE`);
      const [channel] = await tx.select().from(channels).where(eq(channels.id,channelId));
      if (!channel || channel.archivedAt) throw new UploadError("Channel is missing or archived.",409);
      const key = kind === "artwork" ? `artwork/${randomUUID()}.jpg` : `${channel.kind}/${channel.slug}/${randomUUID()}.mp3`;
      await publishImmutable(upload.root,upload.file,key); createdKey = key;
      const canonicalSize = (await stat(join(upload.root,key))).size;
      if (canonicalSize !== upload.size) throw new UploadError("Canonical upload size mismatch.");
      if (kind === "artwork") {
        await tx.update(channels).set({imageKey:key,updatedAt:new Date()}).where(eq(channels.id,channelId));
        return {key};
      }
      const tracks = await tx.select({sortOrder:channelTracks.sortOrder}).from(channelTracks).where(eq(channelTracks.channelId,channelId));
      const sortOrder = tracks.reduce((maximum,track)=>Math.max(maximum,track.sortOrder),-1)+1;
      if (sortOrder > 2147483647) throw new UploadError("Track order limit reached.");
      const [track] = await tx.insert(channelTracks).values({channelId,storageKey:key,originalFilename,sizeBytes:BigInt(canonicalSize),sortOrder,isEnabled:true}).returning({id:channelTracks.id,sizeBytes:channelTracks.sizeBytes});
      if (track.sizeBytes !== BigInt(canonicalSize)) throw new UploadError("Stored track size mismatch.");
      return {key,trackId:track.id};
    });
  } catch(error) {
    if (createdKey) {
      await recordOrphan(upload.root,createdKey,channelId).catch(()=>undefined);
      throw new UploadError("File saved, but DB confirmation failed. An orphan review was recorded; do not blindly repeat or delete it.",503);
    }
    throw error;
  }
}
