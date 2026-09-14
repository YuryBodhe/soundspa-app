import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, stat, open, rm, readdir, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { z } from "zod";
import { mediaRoot, MP3_LIMIT, receiveUpload, UploadError } from "./mediaStorage";

export const CHUNK_BYTES = 512 * 1024;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const metadataSchema = z.object({uploadId:z.string().uuid(),channelId:z.string().uuid(),originalFilename:z.string().min(1).max(200).refine(v=>!/[\/\\\x00-\x1f\x7f]/.test(v)),expectedSize:z.number().int().positive().max(MP3_LIMIT),contentType:z.literal("audio/mpeg")});
export type UploadMetadata = z.infer<typeof metadataSchema>;
export type Session = UploadMetadata & {version:1;createdAt:number;expiresAt:number;offset:number;state:"uploading"|"ready"|"finalizing"|"completed"|"failed"|"expired";key?:string;trackId?:string;sha256?:string;error?:string;integrity?:{expectedSize:number;receivedSize:number;tempSize:number;storedSize:number;sourceSha256:string}};
type Attachment = {id:string;key:string};
type Adapter = {channel:(id:string)=>Promise<{kind:string;slug:string;archivedAt:unknown}|null>;find:(session:Session)=>Promise<boolean>;attach:(session:Session,upload:Awaited<ReturnType<typeof receiveUpload>>,identity:Attachment)=>Promise<void>};
const adapter:Adapter = {
 async channel(id){return (await import("../../db/v2/queries/contentAdmin")).getAdminChannel(id);},
 async find(s){
  if(!s.trackId||!s.key)return false;
  const {v2Db}=await import("../../db/v2/client");const {channelTracks}=await import("../../db/v2/schema");const {eq}=await import("drizzle-orm");
  const [t]=await v2Db.select().from(channelTracks).where(eq(channelTracks.id,s.trackId));
  if(!t)return false;
  if(t.channelId!==s.channelId||t.storageKey!==s.key||t.originalFilename!==s.originalFilename||t.sizeBytes!==BigInt(s.expectedSize))throw new UploadError("Upload identity conflict; operator review required.",409);
  return true;
 },
 async attach(s,u,identity){await (await import("../../db/v2/services/contentUpload")).attachContentUpload(s.channelId,"track",u,s.originalFilename,identity);}
};
// This filesystem protocol supports the existing single staging app process.
// Serializing the entire operation also excludes expiry cleanup from active work.
const active = new Set<string>();
let finalizers=0;
let lastSweep=0;
let cleanupTimer:ReturnType<typeof setInterval>|undefined;
function log(event:string,s:Pick<Session,"uploadId">,details:Record<string,unknown>={}){console.info("[V2ResumableUpload]",event,{uploadId:s.uploadId,...details});}
async function paths(id:string){
 if(!z.string().uuid().safeParse(id).success)throw new UploadError("Invalid upload ID.",400);
 const root=await mediaRoot();const base=join(root,".uploads","sessions");
 await mkdir(base,{recursive:true,mode:0o700});
 // Never follow an operator-created symlink into arbitrary storage.
 for(const p of [join(root,".uploads"),base])if(!(await lstat(p)).isDirectory()||(await lstat(p)).isSymbolicLink())throw new UploadError("Unsafe private upload directory.",503);
 return {root,base,dir:join(base,id)};
}
async function load(dir:string):Promise<Session>{
 try {if((await lstat(dir)).isSymbolicLink())throw new Error("unsafe");return JSON.parse(await readFile(join(dir,"session.json"),"utf8"));}
 catch {throw new UploadError("Upload session not found or unreadable.",404);}
}
async function save(dir:string,s:Session){
 const temp=join(dir,`metadata-${randomUUID()}.tmp`);
 const file=await open(temp,"wx",0o600);
 try{await file.writeFile(JSON.stringify(s));await file.sync();}finally{await file.close();}
 await rename(temp,join(dir,"session.json"));
 const directory=await open(dir,"r");try{await directory.sync();}finally{await directory.close();}
}
async function exclusive<T>(id:string,fn:()=>Promise<T>):Promise<T>{
 if(active.has(id))throw new UploadError("Upload operation in progress; query status shortly.",409);
 active.add(id);try{return await fn();}finally{active.delete(id);}
}
async function expire(dir:string,s:Session){
 if(s.expiresAt>Date.now())return;
 // Only private bytes are removed. Receipts remain for a further day so clients
 // receive an explicit expired result instead of accidentally recreating uploads.
 if(s.state!=="completed"&&s.state!=="expired"){
  s.state="expired";s.error="Upload expired; select the file for a new upload.";
  await save(dir,s);await privateCleanup(dir);log("expired",s);
 }
}
async function privateCleanup(dir:string){
 await rm(join(dir,"partial"),{force:true});
 for(const name of await readdir(dir))if(/^request-[a-zA-Z0-9]+$/.test(name)||/^metadata-[a-f0-9-]+\.tmp$/.test(name))await rm(join(dir,name),{recursive:true,force:true});
}
export async function cleanupExpiredSessions(now=Date.now()){
 const {base}=await paths(randomUUID());
 for(const id of await readdir(base)){
  if(!z.string().uuid().safeParse(id).success||active.has(id))continue;
  await exclusive(id,async()=>{
   const {dir}=await paths(id);const s=await load(dir);
   if(s.expiresAt>now)return;
   await expire(dir,s);
   if(s.expiresAt+SESSION_TTL_MS<now)await rm(dir,{recursive:true,force:true});
  }).catch(()=>log("expiry-skipped",{uploadId:id},{reason:"Active, unreadable or unsafe session; operator review required."}));
 }
}
async function sweep(){if(Date.now()-lastSweep<60000)return;lastSweep=Date.now();await cleanupExpiredSessions();}
function startCleanup(){
 if(cleanupTimer)return;
 cleanupTimer=setInterval(()=>void sweep().catch(()=>console.error("[V2ResumableUpload] expiry-cleanup-failed")),10*60*1000);
 cleanupTimer.unref();
}
export async function createUploadSession(input:unknown,a:Adapter=adapter):Promise<Session>{
 const parsed=metadataSchema.safeParse(input);if(!parsed.success)throw new UploadError("Invalid MP3 upload metadata.",400);
 const m=parsed.data;
 await sweep();
 return exclusive(m.uploadId,async()=>{
  const {dir}=await paths(m.uploadId);
  try {const old=await load(dir);if(!sameMetadata(old,m))throw new UploadError("Upload metadata mismatch.",409);await expire(dir,old);return old;}
  catch(e){if(!(e instanceof UploadError)||e.status!==404)throw e;}
  const c=await a.channel(m.channelId);if(!c||c.archivedAt)throw new UploadError("Channel missing or archived.",409);
  await mkdir(dir,{mode:0o700});
  const now=Date.now();const s:Session={...m,version:1,createdAt:now,expiresAt:now+SESSION_TTL_MS,offset:0,state:"uploading"};
  await writeFile(join(dir,"partial"),Buffer.alloc(0),{flag:"wx",mode:0o600});await save(dir,s);startCleanup();log("session-created",s,{total:s.expectedSize});return s;
 });
}
function sameMetadata(s:UploadMetadata,m:UploadMetadata){return s.channelId===m.channelId&&s.expectedSize===m.expectedSize&&s.originalFilename===m.originalFilename&&s.contentType===m.contentType;}
async function reconcile(dir:string,s:Session,a:Adapter){
 if(s.state==="completed"){await privateCleanup(dir);return;}
 if(s.state==="finalizing"&&await a.find(s)){
  s.state="completed";s.expiresAt=Date.now()+SESSION_TTL_MS;await save(dir,s);await privateCleanup(dir);log("completed-reconciled",s,{trackId:s.trackId});
 }
}
export async function uploadSessionStatus(id:string,a:Adapter=adapter):Promise<Session>{
 // A finalizer owns mutable state; status may safely read its atomic snapshot.
 const {dir}=await paths(id);const s=await load(dir);
 startCleanup();
 if(!active.has(id))return exclusive(id,async()=>{
  await reconcile(dir,s,a);await expire(dir,s);
  if(s.state==="finalizing"){s.state="ready";await save(dir,s);log("finalize-resumable",s);}
  log("status",s,{state:s.state,offset:s.offset});return s;
 });
 return s;
}
export async function acceptUploadChunk(id:string,offset:number,request:Request):Promise<Session>{
 return exclusive(id,async()=>{
  const {dir}=await paths(id);const s=await load(dir);await expire(dir,s);
  if(!["uploading","ready"].includes(s.state))throw new UploadError(`Upload is ${s.state}.`,409);
  if(request.headers.get("x-upload-size")!==String(s.expectedSize)||request.headers.get("x-upload-filename")!==encodeURIComponent(s.originalFilename)||request.headers.get("content-type")!=="application/octet-stream")throw new UploadError("Upload metadata mismatch.",409);
  const length=Number(request.headers.get("x-chunk-size"));const declared=request.headers.get("content-length");
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<=0||length>CHUNK_BYTES||offset+length>s.expectedSize||(declared!==null&&declared!==String(length)))throw new UploadError("Invalid chunk size/offset.",400);
  if(offset>s.offset||(offset<s.offset&&offset+length>s.offset))throw new UploadError("Wrong offset; query server status.",409);
  if(!request.body)throw new UploadError("Empty chunk.",400);
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let received=0;
  const timer=setTimeout(()=>void reader.cancel("Chunk timed out").catch(()=>{}),120000);
  const abort=()=>void reader.cancel("Request aborted").catch(()=>{});request.signal.addEventListener("abort",abort,{once:true});
  try {
   if(request.signal.aborted)throw new UploadError("Chunk interrupted.",408);
   while(true){const {value,done}=await reader.read();if(done)break;received+=value.length;if(received>length)throw new UploadError("Chunk exceeds declared size.",422);chunks.push(value);}
  } finally {clearTimeout(timer);request.signal.removeEventListener("abort",abort);await reader.cancel().catch(()=>{});}
  if(received!==length||request.signal.aborted)throw new UploadError("Incomplete chunk; confirmed offset unchanged.",422);
  const data=Buffer.concat(chunks);const file=await open(join(dir,"partial"),"r+");
  try {
   if(offset<s.offset){const old=Buffer.alloc(length);const r=await file.read(old,0,length,offset);if(r.bytesRead!==length||!old.equals(data))throw new UploadError("Duplicate chunk differs from confirmed bytes.",409);log("duplicate-chunk",s,{offset,length});return s;}
   // Any bytes beyond the durable offset came from an interrupted process and
   // were never acknowledged. Drop only those private, unconfirmed bytes.
   if((await file.stat()).size<s.offset)throw new UploadError("Partial file is inconsistent; operator review required.",409);
   await file.truncate(s.offset);
   let written=0;while(written<data.length){const n=await file.write(data,written,data.length-written,s.offset+written);if(!n.bytesWritten)throw new UploadError("Chunk write failed.",503);written+=n.bytesWritten;}
   await file.sync();s.offset+=length;s.state=s.offset===s.expectedSize?"ready":"uploading";s.expiresAt=Date.now()+SESSION_TTL_MS;await save(dir,s);
  }finally{await file.close();}
  log("chunk-confirmed",s,{offset:s.offset,length});return s;
 });
}
export async function finalizeUploadSession(id:string,a:Adapter=adapter):Promise<Session>{
 if(finalizers>=2)throw new UploadError("Validation busy; query status and retry shortly.",429);
 finalizers++;
 try{return await exclusive(id,async()=>{
  const {dir}=await paths(id);const s=await load(dir);await reconcile(dir,s,a);await expire(dir,s);
  if(s.state==="completed")return s;
  if(!["ready","finalizing"].includes(s.state)||s.offset!==s.expectedSize)throw new UploadError("Upload is not complete.",409);
  if((await stat(join(dir,"partial"))).size!==s.expectedSize)throw new UploadError("Incomplete partial file.",422);
  const c=await a.channel(s.channelId);if(!c||c.archivedAt)throw new UploadError("Channel missing or archived.",409);
  s.trackId??=s.uploadId;s.key??=`${c.kind}/${c.slug}/${s.uploadId}.mp3`;s.state="finalizing";await save(dir,s);log("finalize-start",s);
  let upload:Awaited<ReturnType<typeof receiveUpload>>|undefined;
  try {
   // Reuse the audited full-size/hash/decoder validator; its private validation
   // copy cannot enter canonical storage until all existing checks pass.
   const body=Readable.toWeb(createReadStream(join(dir,"partial"))) as ReadableStream;
   upload=await receiveUpload(new Request("http://internal.invalid",{method:"POST",headers:{"x-upload-size":String(s.expectedSize),"content-length":String(s.expectedSize)},body,duplex:"half"} as RequestInit),"track",dir);
   s.sha256=upload.sha256;s.integrity={expectedSize:upload.expectedSize,receivedSize:upload.receivedSize,tempSize:upload.tempSize,storedSize:upload.size,sourceSha256:upload.sha256};await save(dir,s);
   await a.attach(s,upload,{id:s.trackId,key:s.key});
   s.state="completed";s.expiresAt=Date.now()+SESSION_TTL_MS;await save(dir,s);await rm(join(dir,"partial"),{force:true});log("finalize-complete",s,{trackId:s.trackId,size:s.expectedSize,sha256:s.sha256});return s;
  } catch(e){
   // A committed row wins over a lost response or receipt-write failure.
   if(await a.find(s)){s.state="completed";await save(dir,s);await rm(join(dir,"partial"),{force:true});return s;}
   s.state="failed";s.error=e instanceof UploadError?e.message:"Finalize failed; operator review required.";await save(dir,s);log("finalize-failed",s,{reason:s.error});throw e;
  }finally{await upload?.cleanup();}
 });}finally{finalizers--;}
}
