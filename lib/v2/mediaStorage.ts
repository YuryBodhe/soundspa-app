import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { appendFile, chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import sharp from "sharp";
import { UploadError } from "./uploadError";
import { mediaRoot, safeDirectory } from "./uploadWorkspace";
import { canonicalMediaStorage, type ChannelReference, type TrackReference } from "./canonicalMediaStorage";

export { UploadError } from "./uploadError";
export { mediaRoot } from "./uploadWorkspace";
// Compatibility exports for existing local filesystem callers/tests.
export { publishImmutable, inspectOwnedTrackFile, removeOwnedTrackFile } from "./localMediaStorage";

const execute = promisify(execFile);
export const MP3_LIMIT = 128 * 1024 * 1024;
export const ARTWORK_LIMIT = 10 * 1024 * 1024;
export async function receiveUpload(request: Request, kind: "track" | "artwork", workspace?:string) {
  const root = await mediaRoot();
  const privateDirectory = await safeDirectory(root, ".uploads", 700);
  await chmod(privateDirectory, 0o700);
  const targetDirectory=workspace?await realpath(workspace):privateDirectory;
  if(targetDirectory!==privateDirectory&&!targetDirectory.startsWith(privateDirectory+sep))throw new UploadError("Unsafe validation workspace.");
  const directory = await mkdtemp(join(targetDirectory, "request-"));
  const raw = join(directory, "input");
  try {
    if (!request.body) throw new UploadError("Empty upload.");
    const limit = kind === "track" ? MP3_LIMIT : ARTWORK_LIMIT;
    const declared = request.headers.get("content-length");
    const expectedHeader = request.headers.get("x-upload-size");
    if (!expectedHeader || !/^[1-9]\d*$/.test(expectedHeader) || !Number.isSafeInteger(Number(expectedHeader))) throw new UploadError("Expected file size is required.",400);
    const expectedSize = Number(expectedHeader);
    if (expectedSize > limit) throw new UploadError("Upload exceeds the size limit.",413);
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new UploadError("Upload exceeds the size limit.", 413);
    if (declared && Number(declared) !== expectedSize) throw new UploadError("Declared upload size does not match the selected file.",400);
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({transform(chunk, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(size > expectedSize ? new UploadError("Upload exceeds the expected file size.", 422) : null, chunk);
    }});
    const controller = new AbortController();
    const onAbort = ()=>controller.abort();
    request.signal.addEventListener("abort",onAbort,{once:true});
    if (request.signal.aborted) controller.abort();
    const timeout = setTimeout(()=>controller.abort(),15 * 60 * 1000);
    try {
      await pipeline(Readable.fromWeb(request.body as ReadableStream<Uint8Array>), meter,
        createWriteStream(raw, {flags:"wx", mode:0o600}), {signal:controller.signal});
    } finally { clearTimeout(timeout); request.signal.removeEventListener("abort",onAbort); }
    if (!size) throw new UploadError("Empty upload.");
    const tempSize = (await stat(raw)).size;
    if (size !== expectedSize || tempSize !== expectedSize) throw new UploadError("Incomplete upload: received bytes do not match the selected file.");
    const sha256 = hash.digest("hex");
    if (kind === "track") {
      try {
        const {stdout} = await execute("ffprobe", ["-v","error","-protocol_whitelist","file,pipe","-f","mp3","-show_format","-show_streams","-of","json",raw], {timeout:30000, maxBuffer:1024*1024});
        const info = JSON.parse(stdout);
        const audio = info.streams.filter((stream: {codec_type:string}) => stream.codec_type === "audio");
        if (info.format.format_name !== "mp3" || audio.length !== 1 || audio[0].codec_name !== "mp3" ||
            !(Number(info.format.duration) > 0 && Number(info.format.duration) <= 7200)) throw new Error("Not an acceptable MP3.");
        await execute("ffmpeg", ["-v","error","-xerror","-protocol_whitelist","file,pipe","-f","mp3","-i",raw,"-map","0:a:0","-f","null","-"], {timeout:120000, maxBuffer:1024*1024});
      } catch { throw new UploadError("Invalid MP3: a decodable MP3 audio track, up to two hours, is required."); }
      return {root, directory, file:raw, extension:"mp3", size, expectedSize, receivedSize:size, tempSize, sha256, cleanup:()=>rm(directory,{recursive:true,force:true})};
    }
    try {
      const image = sharp(raw, {limitInputPixels:16_000_000, failOn:"warning"});
      const metadata = await image.metadata();
      if (!["jpeg","png"].includes(metadata.format ?? "") || !metadata.width || !metadata.height ||
          metadata.width < 64 || metadata.height < 64 || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) throw new Error("Invalid image.");
      const file = join(directory,"normalized.jpg");
      await image.rotate().flatten({background:"#ffffff"}).jpeg({quality:90}).toFile(file);
      return {root, directory, file, extension:"jpg", size:(await stat(file)).size, expectedSize, receivedSize:size, tempSize, sha256, cleanup:()=>rm(directory,{recursive:true,force:true})};
    } catch { throw new UploadError("Invalid artwork: single-frame JPEG/PNG, 64–4096 px and at most 16 megapixels, is required."); }
  } catch (error) { await rm(directory,{recursive:true,force:true}); throw error; }
}

export async function recordOrphan(root: string, key: string, channelId: string, reason = "DB outcome failed or ambiguous; reconcile before deletion") {
  try {
    const directory = await safeDirectory(root,".uploads",700);
    await appendFile(join(directory,"orphans.ndjson"), JSON.stringify({key,channelId,at:new Date().toISOString(),reason})+"\n", {mode:0o600});
  } finally { console.error("[V2Upload] orphan-review-required", {key,channelId}); }
}

export async function validateChannelReferences(channel: ChannelReference, tracks: TrackReference[]) {
  try {
    const storage = canonicalMediaStorage(await mediaRoot());
    await storage.validateReferences(channel, tracks);
  } catch { throw new UploadError("Cannot publish: artwork or enabled track media is missing, invalid, or has an unexpected size."); }
}
