import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_TTL_MS, authResponseHeaders } from "@/lib/v2/customerAuthCore";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Request not allowed" }, { status: 403, headers: authResponseHeaders() });
  try {
    const raw = await request.text();
    if (raw.length > 2048) throw new Error("invalid");
    const body = JSON.parse(raw) as { token?: unknown };
    if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw new Error("invalid");
    const { consumeCustomerAuthToken } = await import("@/db/v2/services/customerAuth");
    const result = await consumeCustomerAuthToken(body.token);
    if (!result?.user) return NextResponse.json({ error: "This link is invalid or expired. Request a new one." }, { status: 400, headers: authResponseHeaders() });
    const cookie = `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(result.sessionToken)}; Path=/; Max-Age=${Math.floor(CUSTOMER_SESSION_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`;
    return NextResponse.json({ ok: true }, { headers: authResponseHeaders({ "Set-Cookie": cookie }) });
  } catch {
    return NextResponse.json({ error: "This link is invalid or expired. Request a new one." }, { status: 400, headers: authResponseHeaders() });
  }
}
