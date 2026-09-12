function safeSegments(key: string): string[] {
  const segments = key.split("/");
  if (!segments.every((s) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s) && s !== "." && s !== "..")) {
    throw new Error("Unsupported media key");
  }
  return segments;
}

// Application boundary only; DB storage identities never contain delivery URLs.
export function resolveMediaUrl(kind: "music" | "ambient", storageKey: string): string {
  const segments = safeSegments(storageKey);
  if (!storageKey.endsWith(".mp3")) throw new Error("Unsupported media type");
  if (kind === "music" && segments[0] === "music" && segments.length === 3) {
    return "/" + segments.map(encodeURIComponent).join("/");
  }
  if (kind === "ambient" && segments[0] === "ambient" && segments.length === 2) {
    return "/noise/" + encodeURIComponent(segments[1]);
  }
  throw new Error("Unsupported media delivery mapping");
}

export function resolveImageUrl(imageKey: string | null): string | null {
  return imageKey ? "/" + safeSegments(imageKey).map(encodeURIComponent).join("/") : null;
}
