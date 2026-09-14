import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, stat, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { channels, channelTracks } from "../../db/v2/schema";
import { contentAdminService } from "../../db/v2/services/contentAdmin";
import { attachContentUpload } from "../../db/v2/services/contentUpload";
import { mediaRoot, receiveUpload, publishImmutable, ARTWORK_LIMIT } from "../../lib/v2/mediaStorage";
import { resolveMediaUrl } from "../../app/v2/mediaUrls";

// Explicit synthetic verification only. Exact UUIDs/keys are tracked for cleanup;
// existing channel records and canonical media are never modified.
export async function verifyContentUploads(origin: string, authorization: string, deliveryOrigin?: string, expectedCounts = {channels:6,tracks:8}, largeFixture?: string) {
  const target = (await v2Db.execute(sql`SELECT current_database() AS database,current_user AS "user"`)).rows[0];
  assert.deepEqual(target,{database:"soundspa_v2",user:"soundspa_v2"});
  const snapshot = async()=>(await v2Db.execute(sql`SELECT
    (SELECT count(*)::int FROM channels) AS channels,
    (SELECT count(*)::int FROM channel_tracks) AS tracks,
    (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS migrations,
    (SELECT count(*)::int FROM location_service_access) AS service,
    (SELECT count(*)::int FROM location_channel_entitlements) AS entitlements,
    (SELECT md5(string_agg(row_to_json(c)::text,',' ORDER BY id)) FROM channels c) AS channel_fingerprint,
    (SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY id)) FROM channel_tracks t) AS track_fingerprint`)).rows[0];
  const before=await snapshot();
  assert.equal(before.channels,expectedCounts.channels);assert.equal(before.tracks,expectedCounts.tracks);assert.equal(before.migrations,3);assert.equal(before.service,0);assert.equal(before.entitlements,0);
  const root=await mediaRoot();const fixtures=await mkdtemp(join(tmpdir(),"soundspa-upload-test-"));
  const ids:string[]=[];const keys:string[]=[];const directories:string[]=[];
  let phase="fixtures";
  const upload=async(id:string,kind:"track"|"artwork",data:Buffer,filename:string)=>{
    const response=await fetch(`${origin}/api/v2/admin/content/upload?channelId=${id}&kind=${kind}`,{
      method:"POST",headers:{Authorization:authorization,Origin:origin,"Content-Type":"application/octet-stream","X-Upload-Filename":encodeURIComponent(filename),"X-Upload-Size":String(data.length)},body:new Uint8Array(data),
    });
    const result=await response.json() as {key?:string;trackId?:string;error?:string;integrity?:{expectedSize:number;receivedSize:number;tempSize:number;storedSize:number;sourceSha256:string}};
    if(result.key)keys.push(result.key);
    return {response,result};
  };
  const privateEntries=async()=>{try{return(await readdir(join(root,".uploads"))).filter((name)=>name.startsWith("request-"));}catch{return[];}};
  const privateBefore=await privateEntries();
  try {
    await promisify(execFile)("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=440:duration=1","-codec:a","libmp3lame","-b:a","128k",join(fixtures,"test.mp3")]);
    const audio=await readFile(largeFixture ?? join(fixtures,"test.mp3"));
    const artwork=await sharp({create:{width:128,height:128,channels:3,background:"#69786a"}}).png().toBuffer();
    phase="authorization";
    assert.equal((await fetch(`${origin}/api/v2/admin/content/upload`,{method:"POST",headers:{Origin:origin}})).status,401);
    assert.equal((await fetch(`${origin}/api/v2/admin/content/upload`,{method:"POST",headers:{Authorization:authorization,Origin:"https://untrusted.invalid"}})).status,403);
    for(const kind of ["music","ambient"] as const){
      const slug=`verify-upload-${randomUUID()}`;
      const [channel]=await v2Db.insert(channels).values({slug,displayName:"Synthetic upload verification",kind,isPublished:false}).returning();
      ids.push(channel.id);directories.push(join(root,kind,slug));
      console.info("TEST channel", {id:channel.id,slug,kind});
      if(largeFixture){
        const truncated=await fetch(`${origin}/api/v2/admin/content/upload?channelId=${channel.id}&kind=track`,{method:"POST",headers:{Authorization:authorization,Origin:origin,"Content-Type":"application/octet-stream","X-Upload-Filename":"truncated-test.mp3","X-Upload-Size":String(audio.length)},body:new Uint8Array(audio.subarray(0,10_485_220))});
        assert.equal(truncated.status,400); // Actual Content-Length conflicts with expected source size.
        assert.equal((await v2Db.select().from(channelTracks).where(eq(channelTracks.channelId,channel.id))).length,0);
        assert.deepEqual(await privateEntries(),privateBefore);
      }
      phase=`${kind} invalid uploads`;
      assert.equal((await upload(channel.id,"track",Buffer.from("not MP3"),"fake.mp3")).response.status,422);
      assert.equal((await upload(channel.id,"artwork",Buffer.from("<svg/>"),"fake.png")).response.status,422);
      assert.equal((await upload(channel.id,"track",Buffer.alloc(0),"empty.mp3")).response.status,400);
      await assert.rejects(v2Db.transaction((tx)=>contentAdminService(tx).publication(channel.id,true)),/Artwork image key/);
      phase=`${kind} valid artwork/replacement`;
      const first=await upload(channel.id,"artwork",artwork,"test artwork.png");assert.equal(first.response.status,201,first.result.error);assert(first.result.key);
      const second=await upload(channel.id,"artwork",artwork,"replacement.png");assert.equal(second.response.status,201,second.result.error);assert(second.result.key);assert.notEqual(first.result.key,second.result.key);
      assert.equal((await sharp(join(root,second.result.key)).metadata()).format,"jpeg");
      const [updated]=await v2Db.select().from(channels).where(eq(channels.id,channel.id));assert.equal(updated.imageKey,second.result.key);
      assert((await stat(join(root,first.result.key))).size>0,"Old artwork must be retained");
      phase=`${kind} MP3 and track order`;
      const a=await upload(channel.id,"track",audio,"Original Mix 01.mp3");assert.equal(a.response.status,201,a.result.error);assert(a.result.key);assert(a.result.trackId);
      assert.deepEqual(a.result.integrity,{expectedSize:audio.length,receivedSize:audio.length,tempSize:audio.length,storedSize:audio.length,sourceSha256:createHash("sha256").update(audio).digest("hex")});
      console.info("TEST full-size upload",{channelId:channel.id,trackId:a.result.trackId,key:a.result.key,integrity:a.result.integrity});
      const b=await upload(channel.id,"track",audio,"Original Mix 02.mp3");assert.equal(b.response.status,201,b.result.error);assert(b.result.key);assert.notEqual(a.result.key,b.result.key);
      const tracks=await v2Db.select().from(channelTracks).where(eq(channelTracks.channelId,channel.id));
      assert.equal(tracks.length,2);assert.deepEqual(tracks.map((track)=>track.sortOrder).sort(),[0,1]);
      assert.equal(tracks.find((track)=>track.id===a.result.trackId)?.originalFilename,"Original Mix 01.mp3");
      assert.equal(tracks.find((track)=>track.id===a.result.trackId)?.sizeBytes,BigInt(audio.length));
      assert(a.result.key.startsWith(`${kind}/${slug}/`));
      phase=`${kind} atomic no-overwrite`;
      const received=await receiveUpload(new Request("http://test.invalid",{method:"POST",headers:{"X-Upload-Size":String(audio.length)},body:new Uint8Array(audio)}),"track");
      try{await assert.rejects(publishImmutable(root,received.file,a.result.key),(error:unknown)=>error instanceof Error&&"code"in error&&error.code==="EEXIST");}finally{await received.cleanup();}
      assert.equal(createHash("sha256").update(await readFile(join(root,a.result.key))).digest("hex"),createHash("sha256").update(audio).digest("hex"));
      phase=`${kind} physical publish validation`;
      const rollback=new Error("EXPECTED_ROLLBACK");let published=false;
      try{await v2Db.transaction(async(tx)=>{await contentAdminService(tx).publication(channel.id,true);published=true;throw rollback;});}catch(error){if(error!==rollback)throw error;}
      assert(published);assert.equal((await v2Db.select().from(channels).where(eq(channels.id,channel.id)))[0].isPublished,false);
      if(!deliveryOrigin&&kind==="music"){
        // Deliberate DB failure is exercised only with disposable LOCAL storage.
        // NULL filename violates the existing DB constraint after file creation.
        phase="DB partial failure/orphan reporting";
        const pending=await receiveUpload(new Request("http://test.invalid",{method:"POST",headers:{"X-Upload-Size":String(audio.length)},body:new Uint8Array(audio)}),"track");
        try{
          await assert.rejects(attachContentUpload(channel.id,"track",pending,null as unknown as string),/orphan review/);
          const entries=(await readFile(join(root,".uploads","orphans.ndjson"),"utf8")).trim().split("\n").map((line)=>JSON.parse(line) as {key:string;channelId:string});
          const orphan=entries.find((entry)=>entry.channelId===channel.id);assert(orphan);keys.push(orphan.key);
          assert((await stat(join(root,orphan.key))).size===audio.length,"Ambiguous file must not be blindly deleted");
          assert.equal((await v2Db.select().from(channelTracks).where(eq(channelTracks.channelId,channel.id))).length,2);
        }finally{await pending.cleanup();}
      }
      if(deliveryOrigin){
        phase=`${kind} nginx media and artwork`;
        const url=`${deliveryOrigin}${resolveMediaUrl(kind,a.result.key)}`;
        const full=await fetch(url);assert.equal(full.status,200);assert.equal(Number(full.headers.get("content-length")),audio.length);assert.equal(full.headers.get("content-type"),"audio/mpeg");
        assert.equal(createHash("sha256").update(Buffer.from(await full.arrayBuffer())).digest("hex"),createHash("sha256").update(audio).digest("hex"));
        const range=await fetch(url,{headers:{Range:"bytes=0-99"}});assert.equal(range.status,206);assert.equal(range.headers.get("content-range"),`bytes 0-99/${audio.length}`);assert.equal((await range.arrayBuffer()).byteLength,100);
        assert.equal((await fetch(`${deliveryOrigin}/${second.result.key}`)).status,200);
      }
    }
    phase="size/abort/missing-file cleanup";
    const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(1024*1024));}});
    const request=new Request("http://test.invalid",{method:"POST",headers:{"X-Upload-Size":String(ARTWORK_LIMIT+1)},body:stream,duplex:"half"} as RequestInit&{duplex:string});
    await assert.rejects(receiveUpload(request,"artwork"),(error:unknown)=>error instanceof Error&&"status"in error&&error.status===413);
    const aborted=new AbortController();aborted.abort();
    await assert.rejects(receiveUpload(new Request("http://test.invalid",{method:"POST",headers:{"X-Upload-Size":String(artwork.length)},body:new Uint8Array(artwork),signal:aborted.signal}),"artwork"));
    assert(ARTWORK_LIMIT===10*1024*1024);assert.deepEqual(await privateEntries(),privateBefore);
    await v2Db.transaction(async(tx)=>{
      const channel=(await tx.select().from(channels).where(eq(channels.id,ids[0])))[0];
      const missing=[{storageKey:`music/${channel.slug}/${randomUUID()}.mp3`,sizeBytes:BigInt(1),isEnabled:true}];
      const {validateChannelReferences}=await import("../../lib/v2/mediaStorage");
      await assert.rejects(validateChannelReferences(channel,missing),/Cannot publish/);
    });
    console.info("PASS: upload 401/403; invalid MP3/SVG/empty/oversize/aborted requests rejected and temporary files cleaned; valid music+ambient tracks, original names/order, normalized artwork+immutable replacement; EEXIST no overwrite; real physical publish validation with rollback; generic media/Range/artwork delivery when staging-enabled.");
  }catch(error){console.error(`Upload verification failed at ${phase}`);throw error;}
  finally{
    await v2Db.transaction(async(tx)=>{for(const id of ids){await tx.delete(channelTracks).where(eq(channelTracks.channelId,id));await tx.delete(channels).where(eq(channels.id,id));}});
    for(const key of keys)await rm(join(root,key),{force:true});
    for(const directory of directories){try{await rmdir(directory);}catch(error){if(!(error instanceof Error&&"code"in error&&error.code==="ENOENT"))throw error;}}
    await rm(fixtures,{recursive:true,force:true});
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await privateEntries(),privateBefore);
    console.info("PASS: exact synthetic UUID/file cleanup; catalog fingerprints unchanged.",{before,after:await snapshot(),keys,ids});
    await v2Pool.end();
  }
}
