import { createHash, randomBytes } from "node:crypto";
import type { Locale } from "@/app/i18n/types";

export const CUSTOMER_SESSION_COOKIE = "soundspa_v2_customer";
export const SIGNUP_CONTEXT_COOKIE = "soundspa_v2_signup_context";
export const SIGNUP_CONTEXT_TTL_MS = 30 * 60 * 1000;
export const AUTH_TOKEN_TTL_MS = 30 * 60 * 1000;
export const SIGNUP_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeCustomerEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newHashedOpaqueToken(): { token: string; tokenHash: string } {
  const token = newOpaqueToken();
  return { token, tokenHash: sha256(token) };
}

export function isSupportedLocale(value: unknown): value is Locale {
  return value === "en" || value === "ru" || value === "vi" || value === "th";
}

export function resolveAuthLocale(explicit: unknown, acceptLanguage?: string | null): Locale {
  if (isSupportedLocale(explicit)) return explicit;
  for (const candidate of (acceptLanguage ?? "").split(",")) {
    const language = candidate.trim().split(";", 1)[0]?.split("-", 1)[0]?.toLowerCase();
    if (isSupportedLocale(language)) return language;
  }
  return "en";
}

// Process-local and bounded. Keys are hashes, so raw IPs/emails are never retained.
const buckets = new Map<string, { startedAt: number; count: number }>();
export function allowAuthRequest(key: string, now = Date.now(), limit = 8, windowMs = 15 * 60_000): boolean {
  const hashedKey = sha256(key);
  let bucket = buckets.get(hashedKey);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    if (buckets.size >= 2_000) {
      for (const [storedKey, value] of buckets) if (now - value.startedAt >= windowMs) buckets.delete(storedKey);
      if (buckets.size >= 2_000) buckets.delete(buckets.keys().next().value!);
    }
    bucket = { startedAt: now, count: 0 };
    buckets.set(hashedKey, bucket);
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function clientRateKey(request: Request): string {
  return request.headers.get("x-real-ip")?.slice(0, 128) ?? "unknown-client";
}

export function authResponseHeaders(extra: HeadersInit = {}): HeadersInit {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", ...extra };
}

export function authEmailUrl(request: Request, token: string): string {
  const configured = process.env.V2_PUBLIC_ORIGIN;
  const origin = configured ? new URL(configured).origin : new URL(request.url).origin;
  return `${origin}/login#token=${encodeURIComponent(token)}`;
}
