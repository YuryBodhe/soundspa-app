import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, link, realpath, stat, lstat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import sharp from "sharp";
import { UploadError } from "./uploadError";
import { safeDirectory } from "./uploadWorkspace";
import type { CanonicalMediaStorage, ChannelReference, TrackReference } from "./canonicalMediaStorage";

// Keep server-only storage validation independent from the Next.js app source.
// The standalone runner ships lib/db/scripts, while URL delivery remains owned
// by app/v2/mediaUrls.ts.
function validateMediaKey(kind: "music" | "ambient", storageKey: string) {
  const segments = storageKey.split("/");
  if (!segments.every((segment) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment) && segment !== "." && segment !== "..")) {
    throw new UploadError("Unsupported media key");
  }
  if (!storageKey.endsWith(".mp3")) throw new UploadError("Unsupported media type");
  if (kind === "music" && segments[0] === "music" && segments.length === 3) return;
  if (kind === "ambient" && segments[0] === "ambient" && segments.length >= 2) return;
  throw new UploadError("Unsupported media delivery mapping");
}

function validateImageKey(imageKey: string) {
  if (!imageKey.split("/").every((segment) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment) && segment !== "." && segment !== "..")) {
    throw new UploadError("Unsupported image key");
  }
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

// Only DB-derived music/ambient keys may be passed here. Never follow symlinks.
export async function inspectOwnedTrackFile(root: string, key: string) {
  if (!/^(music|ambient)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.mp3$/.test(key) || key.split("/").some(part => !part || part === "." || part === "..")) throw new UploadError("Unsafe track storage key; deletion rejected.");
  validateMediaKey(key.startsWith("music/") ? "music" : "ambient", key);
  const canonicalRoot = await realpath(root);
  const file = resolve(canonicalRoot,key);
  if (!file.startsWith(canonicalRoot+sep)) throw new UploadError("Unsafe media path.");
  let parent=dirname(file);
  while(parent!==canonicalRoot){
    try {if(await realpath(parent)!==parent) throw new UploadError("Symlink media paths cannot be deleted.");break;}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;parent=dirname(parent);}
  }
  try {
    const info=await lstat(file);
    if(!info.isFile() || await realpath(file)!==file) throw new UploadError("Only owned regular track files can be deleted.");
    return {file,missing:false};
  } catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {file,missing:true};throw error;}
}
export async function removeOwnedTrackFile(root:string,key:string) {
  const target=await inspectOwnedTrackFile(root,key);
  if(target.missing)return "already-missing" as const;
  try {await unlink(target.file);return "removed" as const;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return "already-missing" as const;throw error;}
}

async function existingFile(root: string, key: string) {
  const file = await realpath(join(root,key));
  if (!file.startsWith(root+sep)) throw new UploadError("Media reference escapes storage.");
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) throw new UploadError("Missing or empty referenced media.");
  return {file,info};
}
async function validateLocalReferences(root: string, channel: ChannelReference, tracks: TrackReference[]) {
  try {
    if (!channel.imageKey) throw new Error("Missing artwork.");
    validateImageKey(channel.imageKey);
    const artworkRoot = channel.imageKey.startsWith("artwork/") ? root : resolve(process.cwd(),"public");
    const artwork = await existingFile(artworkRoot,channel.imageKey);
    const metadata = await sharp(artwork.file,{limitInputPixels:16_000_000}).metadata();
    if (!["jpeg","png"].includes(metadata.format ?? "")) throw new Error("Invalid artwork.");
    for (const track of tracks.filter((track)=>track.isEnabled)) {
      validateMediaKey(channel.kind, track.storageKey);
      const stored = await existingFile(root,track.storageKey);
      if (BigInt(stored.info.size) !== track.sizeBytes) throw new Error("Size mismatch.");
    }
  } catch { throw new UploadError("Cannot publish: artwork or enabled track media is missing, invalid, or has an unexpected size."); }
}

async function fileHash(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function localMediaStorage(root: string): CanonicalMediaStorage {
  return {
    publishImmutable: (source, key) => publishImmutable(root, source, key),
    isAlreadyExistsError: error => (error as NodeJS.ErrnoException)?.code === "EEXIST",
    size: async key => (await stat(join(root, key))).size,
    async matchesOwnedTrack(key, expected) {
      const owned = await inspectOwnedTrackFile(root, key);
      if (owned.missing) return false;
      if (expected.size !== undefined && (await stat(owned.file)).size !== expected.size) return false;
      return await fileHash(owned.file) === expected.sha256;
    },
    async inspectOwnedTrack(key) {
      const { missing } = await inspectOwnedTrackFile(root, key);
      return { missing };
    },
    removeOwnedTrack: key => removeOwnedTrackFile(root, key),
    validateReferences: (channel, tracks) => validateLocalReferences(root, channel, tracks),
  };
}
