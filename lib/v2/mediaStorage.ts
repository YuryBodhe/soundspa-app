import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { appendFile, chmod, link, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import sharp from "sharp";
import { resolveImageUrl, resolveMediaUrl } from "../../app/v2/mediaUrls";

const execute = promisify(execFile);
export const MP3_LIMIT = 128 * 1024 * 1024;
export const ARTWORK_LIMIT = 10 * 1024 * 1024;
export class UploadError extends Error {
  constructor(message: string, public status = 422) { super(message); this.name = "UploadError"; }
}
export async function mediaRoot() {
  if (!process.env.V2_MEDIA_ROOT) throw new UploadError("External media storage is not configured.", 503);
  return realpath(process.env.V2_MEDIA_ROOT);
}
async function safeDirectory(root: string, relative: string, mode = 755) {
  const directory = join(root, relative);
  await mkdir(directory, {recursive:true, mode: mode === 700 ? 0o700 : 0o755});
  const actual = await realpath(directory);
  if (!actual.startsWith(root + sep)) throw new UploadError("Unsafe media directory.");
  return actual;
}
export async function receiveUpload(request: Request, kind: "track" | "artwork") {
  const root = await mediaRoot();
  const privateDirectory = await safeDirectory(root, ".uploads", 700);
  await chmod(privateDirectory, 0o700);
  const directory = await mkdtemp(join(privateDirectory, "request-"));
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

// Same-filesystem hard-link publishes atomically and fails with EEXIST. Rename
// would silently overwrite an existing object; it is deliberately not used.
export async function publishImmutable(root: string, source: string, key: string) {
  const parts = key.split("/");
  if (!parts.every((part)=>/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))) throw new UploadError("Invalid generated media key.");
  const parent = await safeDirectory(root, parts.slice(0,-1).join("/"));
  const destination = join(parent,parts.at(-1)!);
  await chmod(source,0o644);
  await link(source,destination);
  // The private link is removed by request cleanup. Nothing fallible follows
  // publication here, so the caller can always account for the canonical file.
}

export async function recordOrphan(root: string, key: string, channelId: string) {
  try {
    const directory = await safeDirectory(root,".uploads",700);
    await appendFile(join(directory,"orphans.ndjson"), JSON.stringify({key,channelId,at:new Date().toISOString(),reason:"DB outcome failed or ambiguous; reconcile before deletion"})+"\n", {mode:0o600});
  } finally { console.error("[V2Upload] orphan-review-required", {key,channelId}); }
}

async function existingFile(root: string, key: string) {
  const file = await realpath(join(root,key));
  if (!file.startsWith(root+sep)) throw new UploadError("Media reference escapes storage.");
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) throw new UploadError("Missing or empty referenced media.");
  return {file,info};
}
export async function validateChannelReferences(channel: {kind:"music"|"ambient";imageKey:string|null}, tracks: {storageKey:string;sizeBytes:bigint;isEnabled:boolean}[]) {
  try {
    if (!channel.imageKey) throw new Error("Missing artwork.");
    resolveImageUrl(channel.imageKey);
    const root = await mediaRoot();
    const artworkRoot = channel.imageKey.startsWith("artwork/") ? root : resolve(process.cwd(),"public");
    const artwork = await existingFile(artworkRoot,channel.imageKey);
    const metadata = await sharp(artwork.file,{limitInputPixels:16_000_000}).metadata();
    if (!["jpeg","png"].includes(metadata.format ?? "")) throw new Error("Invalid artwork.");
    for (const track of tracks.filter((track)=>track.isEnabled)) {
      resolveMediaUrl(channel.kind,track.storageKey);
      const stored = await existingFile(root,track.storageKey);
      if (BigInt(stored.info.size) !== track.sizeBytes) throw new Error("Size mismatch.");
    }
  } catch { throw new UploadError("Cannot publish: artwork or enabled track media is missing, invalid, or has an unexpected size."); }
}
