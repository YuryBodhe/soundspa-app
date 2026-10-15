import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { SIGNUP_CONTEXT_COOKIE, SIGNUP_CONTEXT_TTL_MS, allowAuthRequest, authResponseHeaders, clientRateKey, newOpaqueToken, resolveAuthLocale, sha256 } from "@/lib/v2/customerAuthCore";

export const dynamic = "force-dynamic";
const unavailable = { ok: false, code: "registration_link_unavailable" };

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ ok: false, code: "request_not_allowed" }, { status: 403, headers: authResponseHeaders() });
  if (!allowAuthRequest(`registration-link:${clientRateKey(request)}`)) return NextResponse.json(unavailable, { status: 429, headers: authResponseHeaders() });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json(unavailable, { status: 400, headers: authResponseHeaders() });

  try {
    const raw = await request.text();
    if (raw.length > 512) return NextResponse.json(unavailable, { status: 400, headers: authResponseHeaders() });
    const body = JSON.parse(raw) as { token?: unknown };
    if (!body || typeof body !== "object" || typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
      return NextResponse.json(unavailable, { status: 400, headers: authResponseHeaders() });
    }

    const contextSecret = newOpaqueToken();
    const { beginRegistrationLinkSignup } = await import("@/db/v2/services/registrationLinks");
    await beginRegistrationLinkSignup(body.token, resolveAuthLocale(null, request.headers.get("accept-language")), sha256(contextSecret));
    const cookie = `${SIGNUP_CONTEXT_COOKIE}=${encodeURIComponent(contextSecret)}; Path=/; Max-Age=${Math.floor(SIGNUP_CONTEXT_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`;
    return NextResponse.json({ ok: true }, { headers: authResponseHeaders({ "Set-Cookie": cookie }) });
  } catch {
    return NextResponse.json(unavailable, { status: 400, headers: authResponseHeaders() });
  }
}
