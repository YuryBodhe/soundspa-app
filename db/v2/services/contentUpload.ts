import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { v2Db } from "../client";
import { channels, channelTracks } from "../schema";
import { publishImmutable, recordOrphan, UploadError } from "../../../lib/v2/mediaStorage";
async function fileHash(file:string){const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest("hex");}

export async function attachContentUpload(channelId: string, kind: "track"|"artwork", upload: {root:string;file:string;extension:string;size:number;sha256?:string}, originalFilename: string, identity?:{id:string;key:string}) {
  z.string().uuid().parse(channelId);
  if(identity){z.string().uuid().parse(identity.id);if(kind!=="track"||!upload.sha256)throw new UploadError("Invalid resumable identity.");}
  let createdKey: string | null = null;
  try {
    return await v2Db.transaction(async(tx)=>{
      await tx.execute(sql`SELECT id FROM channels WHERE id=${channelId}::uuid FOR UPDATE`);
      const [channel] = await tx.select().from(channels).where(eq(channels.id,channelId));
      if (!channel || channel.archivedAt) throw new UploadError("Channel is missing or archived.",409);
      const key = identity?.key ?? (kind === "artwork" ? `artwork/${randomUUID()}.jpg` : `${channel.kind}/${channel.slug}/${randomUUID()}.mp3`);
      if(identity){
        if(key!==`${channel.kind}/${channel.slug}/${identity.id}.mp3`)throw new UploadError("Upload/channel identity changed.",409);
        const [existing]=await tx.select().from(channelTracks).where(eq(channelTracks.id,identity.id));
        if(existing){
          if(existing.channelId!==channelId||existing.storageKey!==key||existing.originalFilename!==originalFilename||existing.sizeBytes!==BigInt(upload.size))throw new UploadError("Upload identity conflict.",409);
          const {inspectOwnedTrackFile}=await import("../../../lib/v2/mediaStorage");const owned=await inspectOwnedTrackFile(upload.root,key);
          if(owned.missing||(await stat(owned.file)).size!==upload.size||await fileHash(owned.file)!==upload.sha256)throw new UploadError("Committed upload media mismatch.",409);
          return {key,trackId:existing.id};
        }
      }
      try {await publishImmutable(upload.root,upload.file,key);}
      catch(error){
        // Only a durable resumable session can reuse its exact immutable object
        // after a crash between filesystem publication and transaction commit.
        if(!identity||(error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
        const {inspectOwnedTrackFile}=await import("../../../lib/v2/mediaStorage");
        const owned=await inspectOwnedTrackFile(upload.root,key);
        if(owned.missing||await fileHash(owned.file)!==upload.sha256)throw new UploadError("Existing upload object differs; operator review required.",409);
      }
      createdKey = key;
      const canonicalSize = (await stat(join(upload.root,key))).size;
      if (canonicalSize !== upload.size) throw new UploadError("Canonical upload size mismatch.");
      if (kind === "artwork") {
        await tx.update(channels).set({imageKey:key,updatedAt:new Date()}).where(eq(channels.id,channelId));
        return {key};
      }
      const tracks = await tx.select({sortOrder:channelTracks.sortOrder}).from(channelTracks).where(eq(channelTracks.channelId,channelId));
      const sortOrder = tracks.reduce((maximum,track)=>Math.max(maximum,track.sortOrder),-1)+1;
      if (sortOrder > 2147483647) throw new UploadError("Track order limit reached.");
      const [track] = await tx.insert(channelTracks).values({...identity?{id:identity.id}:{},channelId,storageKey:key,originalFilename,sizeBytes:BigInt(canonicalSize),sortOrder,isEnabled:true}).returning({id:channelTracks.id,sizeBytes:channelTracks.sizeBytes});
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
