import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { receiveUpload } from "../../lib/v2/mediaStorage";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../../proxy";

async function main() {
  const root = await mkdtemp(join(tmpdir(),"soundspa-completeness-"));
  process.env.V2_MEDIA_ROOT = root;
  const file = await readFile(process.argv[2]);
  assert(file.length > 25_000_000 && file.length < 31_000_000);
  const request = (body:Uint8Array,size=file.length,extra:Record<string,string>={}) => new Request("http://test.invalid",{method:"POST",headers:{"X-Upload-Size":String(size),...extra},body:new Uint8Array(body)});
  try {
    for (const length of [10_485_220,10_485_760]) {
      await assert.rejects(receiveUpload(request(new Uint8Array(file.subarray(0,length))),"track"),/Incomplete upload/);
      assert.deepEqual(await readdir(join(root,".uploads")),[]);
      assert.deepEqual(await readdir(root),[".uploads"]); // No canonical track; rejected before DB attachment.
    }
    await assert.rejects(receiveUpload(request(new Uint8Array(file),file.length,{"Content-Length":"10485220"}),"track"),/does not match/);
    const valid=await receiveUpload(request(new Uint8Array(file)),"track");
    assert.equal(valid.expectedSize,file.length);assert.equal(valid.receivedSize,file.length);assert.equal(valid.tempSize,file.length);
    assert.equal((await stat(valid.file)).size,file.length);
    assert.equal(valid.sha256,createHash("sha256").update(file).digest("hex"));
    await valid.cleanup();
    const png=await sharp({create:{width:128,height:128,channels:3,background:"#69786a"}}).png().toBuffer();
    await assert.rejects(receiveUpload(request(new Uint8Array(png.subarray(0,png.length-10)),png.length),"artwork"),/Incomplete upload/);
    const image=await receiveUpload(request(new Uint8Array(png),png.length),"artwork");
    assert.equal(image.receivedSize,png.length);assert.equal(image.size,(await stat(image.file)).size);await image.cleanup();
    for(const url of ["/api/v2/admin/content/upload","/api/v2/admin/content/upload?kind=track"]) assert.equal(unstable_doesMiddlewareMatch({config,nextConfig:{},url}),false);
    for(const url of ["/api/v2/admin/content","/app/admin/channels/v2","/app/admin/channels/v2/abc"]) assert.equal(unstable_doesMiddlewareMatch({config,nextConfig:{},url}),true);
    console.info("PASS: >25MB complete MP3; clean EOF at 10MiB rejected before canonical/DB attachment; temp cleanup; size metadata mismatch; SHA256; artwork pre-normalization completeness; upload-only Proxy bypass.");
  } finally {await rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
