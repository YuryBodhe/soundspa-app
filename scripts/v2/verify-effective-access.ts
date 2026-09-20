import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { organizations, locations, channels, channelTracks, baseChannels, locationServiceAccess, locationChannelEntitlements } from "../../db/v2/schema";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
class VerificationRollback extends Error {}
async function main() {
  try { let orgId = "", locationId = ""; const channelIds: string[] = [];
    try { await v2Db.transaction(async (tx) => {
      const now = new Date(), future = new Date(now.getTime()+60000), past = new Date(now.getTime()-60000), suffix=randomUUID();
      const [org] = await tx.insert(organizations).values({name:`effective-${suffix}`}).returning(); orgId=org.id;
      const [loc] = await tx.insert(locations).values({organizationId:org.id,name:"Effective",slug:`effective-${suffix}`,timezone:"UTC"}).returning(); locationId=loc.id;
      const make = async (slug:string,kind:"music"|"ambient") => { const [c]=await tx.insert(channels).values({slug:`${slug}-${suffix}`,displayName:slug,kind,isPublished:true}).returning(); channelIds.push(c.id); await tx.insert(channelTracks).values({channelId:c.id,storageKey:`synthetic/${suffix}/${slug}.mp3`,originalFilename:`${slug}.mp3`,sizeBytes:BigInt(1),sortOrder:0}); return c.id; };
      const music=await make("music","music"), ambient=await make("ambient","ambient"), included=await make("included","music"), preview=await make("preview","music"), subscribed=await make("subscribed","music"), locked=await make("locked","music");
      await tx.insert(baseChannels).values([{channelId:music},{channelId:ambient}]);
      await tx.insert(locationChannelEntitlements).values([{locationId,channelId:preview,accessType:"preview",expiresAt:future},{locationId,channelId:subscribed,accessType:"subscribed"},{locationId,channelId:included,accessType:"included"}]);
      const get=async(id:string)=> (await resolveEffectiveChannelAccess(locationId,now,tx)).find(c=>c.id===id)!;
      let c=await get(music); assert.deepEqual(c.accessSources,["base"]); assert.equal(c.playable,true);
      c=await get(ambient); assert.deepEqual(c.accessSources,["base"]);
      c=await get(preview); assert.deepEqual(c.accessSources,["preview"]);
      c=await get(included); assert.deepEqual(c.accessSources,["included"]);
      c=await get(subscribed); assert.equal(c.playable,false);
      c=await get(locked); assert.deepEqual(c.accessSources,[]); assert.deepEqual(c.tracks,[]);
      await tx.update(locationServiceAccess).set({paidThrough:future}).where(eq(locationServiceAccess.locationId,locationId));
      c=await get(subscribed); assert.deepEqual(c.accessSources,["custom"]);
      await tx.update(locationServiceAccess).set({suspendedAt:now}).where(eq(locationServiceAccess.locationId,locationId));
      c=await get(music); assert.equal(c.playable,false); assert.deepEqual(c.underlyingSources,["base"]); assert.deepEqual(c.tracks,[]);
      await tx.update(locationServiceAccess).set({suspendedAt:null,paidThrough:null}).where(eq(locationServiceAccess.locationId,locationId));
      await tx.update(locationChannelEntitlements).set({expiresAt:past}).where(eq(locationChannelEntitlements.channelId,preview));
      c=await get(music); assert.deepEqual(c.accessSources,["base"]); c=await get(preview); assert.deepEqual(c.accessSources,[]);
      throw new VerificationRollback();
    }); } catch(e) { if(!(e instanceof VerificationRollback)) throw e; }
    assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id,orgId))).length,0); assert.equal((await v2Db.select().from(locations).where(eq(locations.id,locationId))).length,0); for(const id of channelIds) assert.equal((await v2Db.select().from(channels).where(eq(channels.id,id))).length,0);
    console.info("V2 Effective Access verification PASS: Base, included, preview, custom, suspension, privacy, music/ambient, rollback.");
  } finally { await v2Pool.end(); }
}
main().catch(e=>{console.error(e);process.exitCode=1});
