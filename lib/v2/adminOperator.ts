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

// Public ingress must overwrite forwarded headers. No V1 sessions/cookies.
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return !!origin && !!host && (protocol === "https" || protocol === "http") && origin === `${protocol}://${host}`;
}
