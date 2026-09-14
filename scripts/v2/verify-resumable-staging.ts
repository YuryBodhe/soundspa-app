import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,readFile,rm,stat,readdir,rmdir} from "node:fs/promises";
import {join} from "node:path";
import {eq,sql} from "drizzle-orm";
import {v2Db,v2Pool} from "../../db/v2/client";
import {channels,channelTracks} from "../../db/v2/schema";
import {mediaRoot,inspectOwnedTrackFile} from "../../lib/v2/mediaStorage";
import {resolveMediaUrl} from "../../app/v2/mediaUrls";
async function main(){
 assert(process.argv.includes("--staging"),"Explicit --staging required");
 const origin="https://test.soundspa.bodhemusic.com";
 assert(process.env.V2_ADMIN_USERNAME&&process.env.V2_ADMIN_PASSWORD);
 const authorization="Basic "+Buffer.from(`${process.env.V2_ADMIN_USERNAME}:${process.env.V2_ADMIN_PASSWORD}`).toString("base64");
 const target=(await v2Db.execute(sql`SELECT current_database() AS database,current_user AS "user"`)).rows[0];assert.deepEqual(target,{database:"soundspa_v2",user:"soundspa_v2"});
 const snapshot=async()=>(await v2Db.execute(sql`SELECT (SELECT count(*) FROM channels) AS channels,(SELECT count(*) FROM channel_tracks) AS tracks,(SELECT count(*) FROM drizzle_v2.__drizzle_migrations) AS migrations,(SELECT count(*) FROM location_service_access) AS service,(SELECT count(*) FROM location_channel_entitlements) AS entitlements,(SELECT md5(string_agg(row_to_json(c)::text,',' ORDER BY id)) FROM channels c) AS c,(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY id)) FROM channel_tracks t) AS t`)).rows[0];
 const before=await snapshot();assert.equal(Number(before.channels),Number(process.env.V2_TEST_CHANNELS));assert.equal(Number(before.tracks),Number(process.env.V2_TEST_TRACKS));assert.equal(Number(before.migrations),3);
 const root=await mediaRoot();const work=await mkdtemp("/tmp/v2-resumable-acceptance-");const uploadId=randomUUID(),slug=`verify-resumable-${randomUUID()}`;let channelId:string|undefined,key:string|undefined;
 const sessions=join(root,".uploads/sessions");let privateBefore:string[]=[];try{privateBefore=await readdir(sessions);}catch{}
 const originalFiles=async()=>{
  const out:{key:string;size:number;sha256:string}[]=[];
  async function walk(dir:string){for(const n of await readdir(dir)){if(n===".uploads")continue;const p=join(dir,n),s=await stat(p);if(s.isDirectory())await walk(p);else out.push({key:p.slice(root.length+1),size:s.size,sha256:createHash("sha256").update(await readFile(p)).digest("hex")});}}
  await walk(root);return out.sort((a,b)=>a.key.localeCompare(b.key));
 };
 const mediaBefore=await originalFiles();
 const send=async(method:string,query:string,body?:Uint8Array|string,headers:Record<string,string>={})=>{
  const r=await fetch(`${origin}/api/v2/admin/content/uploads${query}`,{method,headers:{Authorization:authorization,...method!=="GET"?{Origin:origin}:{},...headers},body:typeof body==="string"?body:body?new Uint8Array(body):undefined});
  const value=await r.json();return {r,value};
 };
 try{
  await promisify(execFile)("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=330:duration=3500","-codec:a","libmp3lame","-b:a","128k",join(work,"Synthetic 56MB.mp3")],{timeout:120000});
  const data=await readFile(join(work,"Synthetic 56MB.mp3"));assert(data.length>50_000_000&&data.length<60_000_000);const sha=createHash("sha256").update(data).digest("hex");
  const [c]=await v2Db.insert(channels).values({slug,displayName:"Synthetic resumable acceptance",kind:"music",isPublished:false}).returning();channelId=c.id;
  console.info("TEST synthetic identity",{uploadId,channelId,slug,size:data.length,sha256:sha});
  assert.equal((await fetch(`${origin}/api/v2/admin/content/uploads`,{method:"POST"})).status,401);
  assert.equal((await fetch(`${origin}/api/v2/admin/content/uploads`,{method:"PATCH",headers:{Authorization:authorization,Origin:"https://evil.invalid"}})).status,403);
  const metadata={uploadId,channelId,originalFilename:"Synthetic 56MB.mp3",expectedSize:data.length,contentType:"audio/mpeg"};
  let {r,value}=await send("POST","",JSON.stringify(metadata),{"Content-Type":"application/json"});assert.equal(r.status,200);assert.equal(value.offset,0);
  const chunkHeaders=(n:number)=>({"Content-Type":"application/octet-stream","X-Upload-Size":String(data.length),"X-Upload-Filename":encodeURIComponent(metadata.originalFilename),"X-Chunk-Size":String(n)});
  const q=`?uploadId=${uploadId}`;let offset=0;let interrupted=false;
  while(offset<data.length){
   const n=Math.min(512*1024,data.length-offset);
   if(!interrupted&&offset>=data.length*.4){
    // A clean premature EOF is rejected before offset advance; reconnect status
    // is then the only authority for continuation. No owner file is uploaded.
    const bad=await send("PATCH",`${q}&offset=${offset}`,data.subarray(offset,offset+100),chunkHeaders(n));assert.equal(bad.r.status,400);
    const current=await send("GET",q);assert.equal(current.value.offset,offset);
    assert.equal((await v2Db.select().from(channelTracks).where(eq(channelTracks.channelId,channelId))).length,0);
    console.info("TEST 40% disconnect/reconnect",{offset,confirmed:current.value.offset});interrupted=true;
   }
   const current=await send("PATCH",`${q}&offset=${offset}`,data.subarray(offset,offset+n),chunkHeaders(n));assert.equal(current.r.status,200,current.value.error);assert.equal(current.value.offset,offset+n);
   if(offset===0){const duplicate=await send("PATCH",`${q}&offset=0`,data.subarray(0,n),chunkHeaders(n));assert.equal(duplicate.r.status,200);assert.equal(duplicate.value.offset,n);}
   offset=current.value.offset;
  }
  const finished=await send("POST",`${q}&action=finalize`);assert.equal(finished.r.status,200,finished.value.error);assert.equal(finished.value.state,"completed");key=finished.value.key;
  const repeated=await send("POST",`${q}&action=finalize`);assert.equal(repeated.value.trackId,finished.value.trackId);
  const status=await send("GET",q);assert.equal(status.value.state,"completed");
  const tracks=await v2Db.select().from(channelTracks).where(eq(channelTracks.channelId,channelId));assert.equal(tracks.length,1);assert.equal(tracks[0].id,finished.value.trackId);assert.equal(Number(tracks[0].sizeBytes),data.length);
  assert.deepEqual(finished.value.integrity,{expectedSize:data.length,receivedSize:data.length,tempSize:data.length,storedSize:data.length,sourceSha256:sha});assert(key);
  const canonical=await inspectOwnedTrackFile(root,key);assert.equal((await stat(canonical.file)).size,data.length);assert.equal(createHash("sha256").update(await readFile(canonical.file)).digest("hex"),sha);
  const url=origin+resolveMediaUrl("music",key);const full=await fetch(url);assert.equal(full.status,200);const served=Buffer.from(await full.arrayBuffer());assert.equal(served.length,data.length);assert.equal(createHash("sha256").update(served).digest("hex"),sha);
  const range=await fetch(url,{headers:{Range:"bytes=0-99"}});assert.equal(range.status,206);assert.equal(range.headers.get("content-range"),`bytes 0-99/${data.length}`);assert.equal((await range.arrayBuffer()).byteLength,100);
  console.info("PASS: real HTTPS 56MB chunked upload, 40% premature EOF/reconnect, duplicate chunk, one idempotent DB track, all size/hash identities, served 200/Range206",{uploadId,channelId,key,size:data.length,sha256:sha});
 }finally{
  // Read server-owned identity before exact cleanup even if the last HTTP
  // response was lost. Never infer a canonical path from a browser filename.
  if(channelId){
   const rows=await v2Db.select().from(channelTracks).where(eq(channelTracks.channelId,channelId));assert(rows.every(t=>t.id===uploadId));
   key??=rows[0]?.storageKey;
   await v2Db.transaction(async tx=>{await tx.delete(channelTracks).where(eq(channelTracks.channelId,channelId!));await tx.delete(channels).where(eq(channels.id,channelId!));});
  }
  if(key){assert(key===`music/${slug}/${uploadId}.mp3`);const owned=await inspectOwnedTrackFile(root,key);await rm(owned.file,{force:true});await rmdir(join(root,"music",slug));}
  const privateDir=join(sessions,uploadId);await rm(privateDir,{recursive:true,force:true});await rm(work,{recursive:true,force:true});
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await originalFiles(),mediaBefore);
  let privateAfter:string[]=[];try{privateAfter=await readdir(sessions);}catch{}assert.deepEqual(privateAfter.sort(),privateBefore.sort());
  console.info("PASS: exact synthetic cleanup; original DB fingerprints/media hashes unchanged",{before,after:await snapshot()});await v2Pool.end();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
