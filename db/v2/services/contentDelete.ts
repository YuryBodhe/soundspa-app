import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { v2Db } from "../client";
import { channels, channelTracks } from "../schema";
import { ContentValidationError } from "./contentAdmin";
import { mediaRoot, inspectOwnedTrackFile, removeOwnedTrackFile, recordOrphan } from "../../../lib/v2/mediaStorage";

// DB commit precedes unlink. A failed/ambiguous commit must never delete media.
export async function deleteContentTrack(trackId:string, connection:Pick<typeof v2Db,"transaction"|"select">=v2Db) {
  if(!z.string().uuid().safeParse(trackId).success)throw new ContentValidationError("Invalid track ID.");
  const root=await mediaRoot();
  const deleted=await connection.transaction(async(tx)=>{
    const [initial]=await tx.select().from(channelTracks).where(eq(channelTracks.id,trackId));
    if(!initial)throw new ContentValidationError("Track not found; nothing deleted.");
    await tx.execute(sql`SELECT id FROM channels WHERE id=${initial.channelId}::uuid FOR UPDATE`);
    const [track]=await tx.select().from(channelTracks).where(eq(channelTracks.id,trackId));
    if(!track || track.channelId!==initial.channelId)throw new ContentValidationError("Track changed or disappeared; retry after refreshing.");
    const [channel]=await tx.select().from(channels).where(eq(channels.id,track.channelId));
    if(!channel)throw new ContentValidationError("Channel not found.");
    const siblings=await tx.select().from(channelTracks).where(eq(channelTracks.channelId,channel.id));
    if(channel.isPublished && track.isEnabled && !siblings.some(t=>t.id!==track.id&&t.isEnabled))throw new ContentValidationError("Unpublish before deleting the last enabled track.");
    await inspectOwnedTrackFile(root,track.storageKey);
    await tx.delete(channelTracks).where(eq(channelTracks.id,track.id));
    return track;
  });
  return cleanupDeletedTrack(deleted,root,async()=>{
    const references=await connection.select({id:channelTracks.id}).from(channelTracks).where(eq(channelTracks.storageKey,deleted.storageKey));
    return references.length>0;
  });
}

export async function cleanupDeletedTrack(deleted:typeof channelTracks.$inferSelect,root:string,isReferenced:()=>Promise<boolean>) {
  try {
    if(await isReferenced())return "Track deleted. Media retained because another track references it.";
    const result=await removeOwnedTrackFile(root,deleted.storageKey);
    return result==="removed"?"Track and owned media permanently deleted.":"Track deleted. Its media file was already missing.";
  } catch {
    try {await recordOrphan(root,deleted.storageKey,deleted.channelId,"Track deleted from DB; physical cleanup failed. Recheck references before cleanup.");}
    catch {console.error("[V2ContentDelete] orphan-record-failed",{trackId:deleted.id,storageKey:deleted.storageKey});}
    return "Track deleted from DB, but media cleanup failed. Orphan cleanup review is required.";
  }
}
