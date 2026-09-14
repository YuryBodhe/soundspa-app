import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from "node:fs/promises";
import {join} from "node:path";
import {eq,sql} from "drizzle-orm";
import {v2Db,v2Pool} from "../../db/v2/client";
import {channels,channelTracks} from "../../db/v2/schema";
import {deleteContentTrack,cleanupDeletedTrack} from "../../db/v2/services/contentDelete";
import {inspectOwnedTrackFile} from "../../lib/v2/mediaStorage";

async function main(){
 const target=(await v2Db.execute(sql`SELECT current_database() AS database,current_user AS "user"`)).rows[0];
 assert.deepEqual(target,{database:"soundspa_v2",user:"soundspa_v2"});
 const snapshot=async()=>(await v2Db.execute(sql`SELECT (SELECT count(*) FROM channels) AS channels,(SELECT count(*) FROM channel_tracks) AS tracks,(SELECT md5(string_agg(row_to_json(c)::text,',' ORDER BY id)) FROM channels c) AS c,(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY id)) FROM channel_tracks t) AS t`)).rows[0];
 const before=await snapshot();assert.equal(Number(before.channels),Number(process.env.V2_TEST_CHANNELS??8));assert.equal(Number(before.tracks),Number(process.env.V2_TEST_TRACKS??11));
 const root=await mkdtemp("/tmp/soundspa-delete-test-");process.env.V2_MEDIA_ROOT=root;
 const dir=join(root,"music","synthetic");await mkdir(dir,{recursive:true});
 const rollback=new Error("EXPECTED_ROLLBACK");
 try{
  try{await v2Db.transaction(async(tx)=>{
   const [channel]=await tx.insert(channels).values({slug:`verify-delete-${randomUUID()}`,displayName:"Synthetic deletion",kind:"music",isPublished:true}).returning();
   const track=async(enabled:boolean,key=`music/synthetic/${randomUUID()}.mp3`,file=true)=>{
    if(file)await writeFile(join(root,key),"test owned bytes");
    return (await tx.insert(channelTracks).values({channelId:channel.id,storageKey:key,originalFilename:"Synthetic.mp3",sizeBytes:BigInt(16),sortOrder:0,isEnabled:enabled}).returning())[0];
   };
   const active=await track(true),disabled=await track(false),second=await track(true);
   assert.match(await deleteContentTrack(disabled.id,tx),/permanently deleted/);
   assert.equal((await tx.select().from(channelTracks).where(eq(channelTracks.id,disabled.id))).length,0);
   await assert.rejects(readFile(join(root,disabled.storageKey)),{code:"ENOENT"});
   assert.match(await deleteContentTrack(second.id,tx),/permanently deleted/);
   await assert.rejects(deleteContentTrack(active.id,tx),/last enabled/);
   assert((await readFile(join(root,active.storageKey))).length>0);
   assert.equal((await tx.select().from(channelTracks).where(eq(channelTracks.id,active.id))).length,1);
   await assert.rejects(deleteContentTrack(randomUUID(),tx),/not found/);
   const unsafe=await track(false,"music/../outside.mp3",false);
   await assert.rejects(deleteContentTrack(unsafe.id,tx),/Unsafe/);
   assert.equal((await tx.select().from(channelTracks).where(eq(channelTracks.id,unsafe.id))).length,1);
   const missing=await track(false,undefined,false);
   assert.match(await deleteContentTrack(missing.id,tx),/already missing/);
   const shared=await track(false);
   assert.match(await cleanupDeletedTrack(shared,root,async()=>true),/another track/);
   assert((await readFile(join(root,shared.storageKey))).length>0);
   // Same storage_key cannot actually be duplicated: schema UNIQUE. Simulate the safety check.
   await symlink("/tmp",join(root,"music","outside"));
   await assert.rejects(inspectOwnedTrackFile(root,"music/outside/absent.mp3"),/Symlink/);
   await assert.rejects(inspectOwnedTrackFile(root,"/tmp/anything.mp3"),/Unsafe/);
   const pending=await track(false);
   const result=await cleanupDeletedTrack(pending,root,async()=>{throw new Error("cleanup reference check failed");});
   assert.match(result,/cleanup failed/);assert((await readFile(join(root,pending.storageKey))).length>0);
   assert((await readFile(join(root,".uploads","orphans.ndjson"),"utf8")).includes(pending.storageKey));
   const empty=await tx.insert(channels).values({slug:`verify-delete-${randomUUID()}`,displayName:"Draft deletion",kind:"ambient",isPublished:false}).returning();
   const draft=await track(true);await tx.update(channelTracks).set({channelId:empty[0].id}).where(eq(channelTracks.id,draft.id));
   assert.match(await deleteContentTrack(draft.id,tx),/permanently deleted/);
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
  assert.deepEqual(await snapshot(),before);
  console.info("PASS: disabled/non-last/draft deletion; published last track rejected; nonexistent/unsafe/symlink rejected; missing deterministic; shared media retained; cleanup failure records orphan. All DB synthetic data rolled back.",{before,after:await snapshot()});
 }finally{await rm(root,{recursive:true,force:true});await v2Pool.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
