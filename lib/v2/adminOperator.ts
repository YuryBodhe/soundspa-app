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
export type SameOriginRejectBranch =
  | "effective-public-origin-unavailable"
  | "origin-invalid"
  | "origin-mismatch"
  | "referer-invalid"
  | "referer-mismatch"
  | "fetch-site-not-same-origin";

export type SameOriginDiagnosticFields = {
  originPresent: boolean;
  originValue: string | null;
  refererPresent: boolean;
  refererOrigin: string | null;
  secFetchSite: string | null;
  secFetchMode: string | null;
  secFetchDest: string | null;
  host: string | null;
  xForwardedHost: string | null;
  xForwardedProto: string | null;
  configuredPublicOrigin: string | null;
  effectivePublicOrigin: string | null;
  validatorBranch: SameOriginRejectBranch;
};

function redactKnownSecret(value: string, secret?: string): string {
  return secret && value.toLowerCase().includes(secret.toLowerCase()) ? "<redacted>" : value;
}

function originOnly(value: string | null, secret?: string): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return "<invalid>";
    return redactKnownSecret(url.origin, secret);
  } catch {
    return "<invalid>";
  }
}

function hostOnly(value: string | null, secret?: string): string | null {
  if (value === null) return null;
  // Host fields should contain only a host (optionally a port), never a path.
  if (!/^[A-Za-z0-9.:[\]-]+$/.test(value)) return "<invalid>";
  try {
    const url = new URL(`https://${value}`);
    if (url.username || url.password || url.pathname !== "/") return "<invalid>";
    return redactKnownSecret(url.host, secret);
  } catch {
    return "<invalid>";
  }
}

function fetchMetadata(value: string | null, allowed: readonly string[]): string | null {
  if (value === null) return null;
  const normalized = value.toLowerCase();
  return allowed.includes(normalized) ? normalized : "<other>";
}

export function sameOriginDiagnosticFields(
  request: Request,
  validatorBranch: SameOriginRejectBranch,
  activationToken: string,
): SameOriginDiagnosticFields {
  const configured = process.env.V2_PUBLIC_ORIGIN?.trim() || null;
  return {
    originPresent: request.headers.has("origin"),
    originValue: originOnly(request.headers.get("origin"), activationToken),
    refererPresent: request.headers.has("referer"),
    refererOrigin: originOnly(request.headers.get("referer"), activationToken),
    secFetchSite: fetchMetadata(request.headers.get("sec-fetch-site"), ["same-origin", "same-site", "cross-site", "none"]),
    secFetchMode: fetchMetadata(request.headers.get("sec-fetch-mode"), ["navigate", "same-origin", "no-cors", "cors", "websocket"]),
    secFetchDest: fetchMetadata(request.headers.get("sec-fetch-dest"), ["", "document", "iframe", "image", "script", "style", "font", "audio", "video", "track", "embed", "object", "worker", "sharedworker", "serviceworker", "manifest", "empty"]),
    host: hostOnly(request.headers.get("host"), activationToken),
    xForwardedHost: hostOnly(request.headers.get("x-forwarded-host"), activationToken),
    xForwardedProto: fetchMetadata(request.headers.get("x-forwarded-proto"), ["http", "https"]),
    configuredPublicOrigin: configured ? originOnly(configured, activationToken) : null,
    effectivePublicOrigin: redactKnownSecret(effectivePublicOrigin(request) ?? "", activationToken) || null,
    validatorBranch,
  };
}

export function isSameOriginMutation(request: Request, onReject?: (branch: SameOriginRejectBranch) => void): boolean {
  const reject = (branch: SameOriginRejectBranch) => {
    onReject?.(branch);
    return false;
  };
  const expectedOrigin = effectivePublicOrigin(request);
  if (!expectedOrigin) return reject("effective-public-origin-unavailable");

  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(origin).origin === expectedOrigin || reject("origin-mismatch");
    } catch {
      return reject("origin-invalid");
    }
  }

  const referer = request.headers.get("referer");
  if (referer !== null) {
    try {
      return new URL(referer).origin === expectedOrigin || reject("referer-mismatch");
    } catch {
      return reject("referer-invalid");
    }
  }

  return request.headers.get("sec-fetch-site") === "same-origin" || reject("fetch-site-not-same-origin");
}
