function safeSegments(key: string): string[] {
  const segments = key.split("/");
  if (!segments.every((s) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s) && s !== "." && s !== "..")) {
    throw new Error("Unsupported media key");
  }
  return segments;
}

// Application boundary only; DB storage identities never contain delivery URLs.
export type MediaDeliveryBackend = "local" | "cdn";
export function mediaDeliveryBackend(): MediaDeliveryBackend {
  const value = process.env.V2_MEDIA_DELIVERY_BACKEND?.trim() || "local";
  if (value !== "local" && value !== "cdn") throw new Error("Unsupported V2_MEDIA_DELIVERY_BACKEND");
  return value;
}
function cdnBaseUrl(): string {
  const value = (process.env.V2_MEDIA_CDN_BASE_URL || "https://media.soundspa.bodhemusic.com").trim().replace(/\/+$/, "");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Invalid V2_MEDIA_CDN_BASE_URL"); }
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error("Invalid V2_MEDIA_CDN_BASE_URL");
  return value;
}
export function resolveMediaUrl(kind: "music" | "ambient", storageKey: string): string {
  const segments = safeSegments(storageKey);
  if (!storageKey.endsWith(".mp3")) throw new Error("Unsupported media type");
  if (mediaDeliveryBackend() === "cdn") {
    if ((kind === "music" && segments[0] !== "music") || (kind === "ambient" && segments[0] !== "ambient")) throw new Error("Unsupported media delivery mapping");
    if (kind === "music" && segments.length !== 3) throw new Error("Unsupported media delivery mapping");
    if (kind === "ambient" && segments.length < 2) throw new Error("Unsupported media delivery mapping");
    return `${cdnBaseUrl()}/${segments.map(encodeURIComponent).join("/")}`;
  }
  if (kind === "music" && segments[0] === "music" && segments.length === 3) {
    return "/" + segments.map(encodeURIComponent).join("/");
  }
  if (kind === "ambient" && segments[0] === "ambient" && segments.length >= 2) {
    return "/noise/" + segments.slice(1).map(encodeURIComponent).join("/");
  }
  throw new Error("Unsupported media delivery mapping");
}

export function resolveImageUrl(imageKey: string | null): string | null {
  return imageKey ? "/" + safeSegments(imageKey).map(encodeURIComponent).join("/") : null;
}
