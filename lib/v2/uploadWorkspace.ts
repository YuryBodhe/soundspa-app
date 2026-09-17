import { mkdir, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { UploadError } from "./uploadError";

// Private validation/session workspace remains on disk, independently of the
// canonical storage backend. LOCAL publication requires the same filesystem.
export async function mediaRoot() {
  if (!process.env.V2_MEDIA_ROOT) throw new UploadError("External media storage is not configured.", 503);
  return realpath(process.env.V2_MEDIA_ROOT);
}
export async function safeDirectory(root: string, relative: string, mode = 755) {
  const directory = join(root, relative);
  await mkdir(directory, {recursive:true, mode: mode === 700 ? 0o700 : 0o755});
  const actual = await realpath(directory);
  if (!actual.startsWith(root + sep)) throw new UploadError("Unsafe media directory.");
  return actual;
}
