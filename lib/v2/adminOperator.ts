import { createHash, timingSafeEqual } from "node:crypto";

export function operatorAuthStatus(authorization: string | null): 200 | 401 | 503 {
  const user = process.env.V2_ADMIN_USERNAME;
  const password = process.env.V2_ADMIN_PASSWORD;
  if (!user || !password || user.includes(":")) return 503;
  if (!authorization?.startsWith("Basic ") || authorization.length > 4096) return 401;
  const supplied = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(`${user}:${password}`)) ? 200 : 401;
}

export function operatorAuthResponse(status: 401 | 503): Response {
  return new Response(status === 401 ? "V2 operator authorization required." : "V2 operator access is not configured.", {
    status,
    headers: { "Cache-Control": "no-store", ...(status === 401 ? { "WWW-Authenticate": 'Basic realm="SoundSpa V2 Content", charset="UTF-8"' } : {}) },
  });
}

// Prefer the configured public origin: request.url may identify the internal
// app/container behind ingress. Do not derive trust from X-Forwarded-Host.
function effectivePublicOrigin(request: Request): string | null {
  const configured = process.env.V2_PUBLIC_ORIGIN?.trim();
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("host");
  const value = configured || (host && (protocol === "https" || protocol === "http") ? `${protocol}://${host}` : "");
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// Public ingress must overwrite forwarded headers. Browser form POSTs normally
// include Origin; Referrer-Policy may suppress Referer, so Fetch Metadata is a
// narrow final fallback. No V1 sessions/cookies.
export function isSameOriginMutation(request: Request): boolean {
  const expectedOrigin = effectivePublicOrigin(request);
  if (!expectedOrigin) return false;

  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(origin).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer !== null) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return request.headers.get("sec-fetch-site") === "same-origin";
}
