import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, stat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { receiveUpload,publishImmutable,recordOrphan } from "../../lib/v2/mediaStorage";

// Filesystem-only check: no database, SSH, or staging writes.
async function main(){
  const root=await realpath(await mkdtemp(join(tmpdir(),"soundspa-storage-unit-")));
  process.env.V2_MEDIA_ROOT=root;
  try{
    await promisify(execFile)("ffmpeg",["-v","error","-f","lavfi","-i","sine=duration=1","-codec:a","libmp3lame",join(root,"fixture.mp3")]);
    const mp3=await readFile(join(root,"fixture.mp3"));
    const request=(data:Uint8Array)=>new Request("http://local.test",{method:"POST",headers:{"X-Upload-Size":String(data.length)},body:new Uint8Array(data)});
    const received=await receiveUpload(request(mp3),"track");
    await publishImmutable(root,received.file,"music/unit/immutable.mp3");
    await assert.rejects(publishImmutable(root,received.file,"music/unit/immutable.mp3"),(error:unknown)=>error instanceof Error&&"code"in error&&error.code==="EEXIST");
    await received.cleanup();assert.deepEqual(await readFile(join(root,"music/unit/immutable.mp3")),mp3);
    for(const data of [Buffer.from("not an MP3"),Buffer.from("#EXTM3U\nhttps://example.invalid/file.mp3"),mp3.subarray(0,20),Buffer.alloc(0)])await assert.rejects(receiveUpload(request(data),"track"));
    const png=await sharp({create:{width:128,height:128,channels:3,background:"#698475"}}).png().toBuffer();
    const image=await receiveUpload(request(png),"artwork");assert.equal((await sharp(image.file).metadata()).format,"jpeg");await image.cleanup();
    for(const data of [Buffer.from("<svg/>"),await sharp({create:{width:1,height:1,channels:3,background:"#ffffff"}}).png().toBuffer()])await assert.rejects(receiveUpload(request(data),"artwork"));
    const declared=new Request("http://local.test",{method:"POST",headers:{"Content-Length":String(11*1024*1024)},body:new Uint8Array(png)});
    await assert.rejects(receiveUpload(declared,"artwork"));
    assert.deepEqual(await readdir(join(root,".uploads")),[]);
    assert.equal((await stat(join(root,".uploads"))).mode&0o777,0o700);
    await recordOrphan(root,"music/unit/immutable.mp3","synthetic-unit-test");
    assert.equal(JSON.parse((await readFile(join(root,".uploads/orphans.ndjson"),"utf8")).trim()).key,"music/unit/immutable.mp3");
    console.info("PASS: local-only MP3 decoder/protocol validation, actual PNG normalization, invalid/truncated/empty/oversize rejection, private temp cleanup, atomic no-overwrite publication, and private orphan accounting.");
  }finally{await rm(root,{recursive:true,force:true});}
}
main().catch((error)=>{console.error(error instanceof Error?error.message:"Failed");process.exitCode=1;});
