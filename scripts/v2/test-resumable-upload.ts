import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {mkdtemp,readFile,writeFile,stat,readdir,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createUploadSession,acceptUploadChunk,uploadSessionStatus,finalizeUploadSession,cleanupExpiredSessions,CHUNK_BYTES,SESSION_TTL_MS,type Session} from "../../lib/v2/resumableUpload";
import {publishImmutable} from "../../lib/v2/mediaStorage";
import {AsyncLocalStorage} from "node:async_hooks";
import {resumeMp3Upload,UploadResponseError} from "../../app/app/admin/channels/v2/resumableClient";
async function main(){
 const root=await mkdtemp(join(tmpdir(),"soundspa-resumable-test-"));process.env.V2_MEDIA_ROOT=root;
 const rows=new Map<string,{key:string;size:number}>();let attachments=0;
 const adapter={channel:async()=>({kind:"music",slug:"synthetic",archivedAt:null}),find:async(s:Session)=>!!s.trackId&&rows.has(s.trackId),attach:async(s:Session,u:{root:string;file:string;size:number},identity:{id:string;key:string})=>{attachments++;await publishImmutable(u.root,u.file,identity.key);rows.set(identity.id,{key:identity.key,size:u.size});}};
 const channelId=randomUUID();
 try{
  await promisify(execFile)("ffmpeg",["-v","error","-f","lavfi","-i","sine=duration=90","-codec:a","libmp3lame","-b:a","128k",join(root,"fixture.mp3")]);
  const bytes=await readFile(join(root,"fixture.mp3"));assert(bytes.length>2*CHUNK_BYTES);
  const metadata=(id=randomUUID())=>({uploadId:id,channelId,originalFilename:"Synthetic resumable.mp3",expectedSize:bytes.length,contentType:"audio/mpeg" as const});
  const request=(m:ReturnType<typeof metadata>,data:Buffer,length=data.length)=>new Request("http://test.invalid",{method:"PATCH",headers:{"content-type":"application/octet-stream","x-upload-size":String(m.expectedSize),"x-upload-filename":encodeURIComponent(m.originalFilename),"x-chunk-size":String(length)},body:new Uint8Array(data)});
  const m=metadata();await createUploadSession(m,adapter);assert.equal((await createUploadSession(m,adapter)).offset,0);
  await assert.rejects(createUploadSession({...m,originalFilename:"different.mp3"},adapter),/metadata mismatch/);
  let s=await acceptUploadChunk(m.uploadId,0,request(m,bytes.subarray(0,CHUNK_BYTES)));
  assert.equal(s.offset,CHUNK_BYTES);
  // Approximately 40% received; second chunk disconnects mid-body. No offset
  // advance and no canonical/DB object, then a new connection resumes.
  await assert.rejects(acceptUploadChunk(m.uploadId,s.offset,request(m,bytes.subarray(CHUNK_BYTES,CHUNK_BYTES+100),CHUNK_BYTES)),/Incomplete chunk/);
  assert.equal((await uploadSessionStatus(m.uploadId,adapter)).offset,CHUNK_BYTES);assert.equal(rows.size,0);
  assert.equal((await acceptUploadChunk(m.uploadId,0,request(m,bytes.subarray(0,CHUNK_BYTES)))).offset,CHUNK_BYTES);
  await assert.rejects(acceptUploadChunk(m.uploadId,0,request(m,Buffer.alloc(CHUNK_BYTES))),/Duplicate chunk differs/);
  await assert.rejects(acceptUploadChunk(m.uploadId,CHUNK_BYTES+1,request(m,Buffer.alloc(1))),/Wrong offset/);
  await assert.rejects(acceptUploadChunk(m.uploadId,s.offset,request({...m,expectedSize:bytes.length+1},Buffer.alloc(1))),/metadata mismatch/);
  await assert.rejects(finalizeUploadSession(m.uploadId,adapter),/not complete/);
  while(s.offset<bytes.length)s=await acceptUploadChunk(m.uploadId,s.offset,request(m,bytes.subarray(s.offset,Math.min(bytes.length,s.offset+CHUNK_BYTES))));
  assert.equal(s.state,"ready");const done=await finalizeUploadSession(m.uploadId,adapter);
  assert.equal(done.state,"completed");assert.equal(rows.size,1);assert.equal(attachments,1);
  assert.equal(done.sha256,createHash("sha256").update(bytes).digest("hex"));assert.equal(rows.get(done.trackId!)?.size,bytes.length);
  assert.deepEqual(await readFile(join(root,done.key!)),bytes);
  assert.equal((await finalizeUploadSession(m.uploadId,adapter)).trackId,done.trackId);assert.equal(attachments,1);
  await assert.rejects(stat(join(root,".uploads/sessions",m.uploadId,"partial")),{code:"ENOENT"});
  // Crash/lost receipt after DB commit is reconciled, not attached twice.
  const receipt=join(root,".uploads/sessions",m.uploadId,"session.json");
  await writeFile(receipt,JSON.stringify({...done,state:"finalizing"}));
  assert.equal((await uploadSessionStatus(m.uploadId,adapter)).state,"completed");assert.equal(attachments,1);
  const expired=metadata();await createUploadSession(expired,adapter);await acceptUploadChunk(expired.uploadId,0,request(expired,bytes.subarray(0,100)));
  const ep=join(root,".uploads/sessions",expired.uploadId);const es=JSON.parse(await readFile(join(ep,"session.json"),"utf8"));es.expiresAt=Date.now()-1;await writeFile(join(ep,"session.json"),JSON.stringify(es));await cleanupExpiredSessions();
  assert.equal((await uploadSessionStatus(expired.uploadId,adapter)).state,"expired");await assert.rejects(stat(join(ep,"partial")),{code:"ENOENT"});assert.deepEqual(await readFile(join(root,done.key!)),bytes);
  assert(SESSION_TTL_MS===86400000);
  const live=metadata();await createUploadSession(live,adapter);const stop=new AbortController();
  const pendingBody=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(100));}});
  const liveRequest=new Request("http://test.invalid",{method:"PATCH",headers:{"content-type":"application/octet-stream","x-upload-size":String(live.expectedSize),"x-upload-filename":encodeURIComponent(live.originalFilename),"x-chunk-size":String(CHUNK_BYTES)},body:pendingBody,signal:stop.signal,duplex:"half"} as RequestInit);
  const pending=acceptUploadChunk(live.uploadId,0,liveRequest);const rejected=assert.rejects(pending,/Incomplete chunk/);
  await new Promise(r=>setTimeout(r,20));const lp=join(root,".uploads/sessions",live.uploadId);const ls=JSON.parse(await readFile(join(lp,"session.json"),"utf8"));ls.expiresAt=Date.now()-1;await writeFile(join(lp,"session.json"),JSON.stringify(ls));
  await cleanupExpiredSessions();assert.equal((await stat(join(lp,"partial"))).size,0); // Active request excluded from expiry.
  stop.abort();await rejected;await cleanupExpiredSessions();await assert.rejects(stat(join(lp,"partial")),{code:"ENOENT"});
  process.env.V2_ADMIN_USERNAME="test";process.env.V2_ADMIN_PASSWORD="test-password";
  (globalThis as unknown as {AsyncLocalStorage:typeof AsyncLocalStorage}).AsyncLocalStorage=AsyncLocalStorage;
  const {GET,POST,PATCH}=await import("../../app/api/v2/admin/content/uploads/route");
  const {unstable_doesMiddlewareMatch}=await import("next/experimental/testing/server");const {config}=await import("../../proxy");
  const auth="Basic "+Buffer.from("test:test-password").toString("base64");
  for(const fn of [GET,POST,PATCH])assert.equal((await fn(new Request("http://local.test/api/v2/admin/content/uploads",{method:fn===GET?"GET":fn===PATCH?"PATCH":"POST"}))).status,401);
  for(const fn of [POST,PATCH])assert.equal((await fn(new Request("http://local.test/api/v2/admin/content/uploads",{method:fn===PATCH?"PATCH":"POST",headers:{authorization:auth,origin:"https://evil.invalid",host:"local.test"}}))).status,403);
  assert.equal((await GET(new Request("http://local.test/api/v2/admin/content/uploads?uploadId=invalid",{headers:{authorization:auth}}))).status,400);
  assert.equal(unstable_doesMiddlewareMatch({config,nextConfig:{},url:"/api/v2/admin/content/uploads"}),false);
  // Client reconnect uses status and does not retransmit confirmed bytes; lost
  // finalize response is resolved by completed status, without a second POST.
  let offset=0,finished=false,lostChunk=false,lostFinalize=false,finalizeCalls=0;const offsets:number[]=[];
  const status=()=>({uploadId:m.uploadId,offset,expectedSize:bytes.length,state:finished?"completed" as const:offset===bytes.length?"ready" as const:"uploading" as const});
  const fake=async(method:string,url:string,body:Blob|string|null)=>{
   if(method==="GET")return status();
   if(method==="PATCH"){const p=Number(new URL(url,"http://test.invalid").searchParams.get("offset"));assert.equal(p,offset);offsets.push(p);offset+=(body as Blob).size;if(!lostChunk){lostChunk=true;throw new Error("lost response");}return status();}
   finalizeCalls++;finished=true;if(!lostFinalize){lostFinalize=true;throw new Error("lost finalize response");}return status();
  };
  const file=new File([bytes],m.originalFilename);assert(await resumeMp3Upload(file,channelId,m.uploadId,()=>{},()=>false,fake,async()=>{}));assert.equal(finalizeCalls,1);assert.deepEqual(offsets,[0,CHUNK_BYTES,CHUNK_BYTES*2]);
  console.info("PASS: complete canonical/hash/row; ~40% disconnect and confirmed-offset resume; duplicate/wrong offset/metadata/truncation; repeated finalize/lost receipt; expiry private-only cleanup; route auth/origin/Proxy bypass; client lost chunk/finalize responses reconcile without duplicate.");
 }finally{await rm(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
