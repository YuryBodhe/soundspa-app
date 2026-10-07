import { NextResponse } from "next/server";
import { SIGNUP_CONTEXT_TTL_MS, SIGNUP_CONTEXT_COOKIE, SIGNUP_INTENT_TTL_MS, allowAuthRequest, authResponseHeaders, clientRateKey, newOpaqueToken, resolveAuthLocale, sha256 } from "@/lib/v2/customerAuthCore";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const redirectOrigin = process.env.V2_PUBLIC_ORIGIN ? new URL(process.env.V2_PUBLIC_ORIGIN).origin : new URL(request.url).origin;
  const destination = new URL("/signup?source=partner", redirectOrigin);
  const response = NextResponse.redirect(destination, { status: 303, headers: authResponseHeaders() });
  if (token.length > 0 && token.length <= 256 && allowAuthRequest(`join:${clientRateKey(request)}`)) {
    const contextSecret = newOpaqueToken();
    try {
      const { v2Db } = await import("@/db/v2/client");
      const { customerSignupIntents } = await import("@/db/v2/schema");
      await v2Db.insert(customerSignupIntents).values({
        inviteTokenHash: sha256(token), contextTokenHash: sha256(contextSecret), locale: resolveAuthLocale(null, request.headers.get("accept-language")),
        expiresAt: new Date(Date.now() + SIGNUP_INTENT_TTL_MS),
      });
      response.cookies.set(SIGNUP_CONTEXT_COOKIE, contextSecret, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: Math.floor(SIGNUP_CONTEXT_TTL_MS / 1000),
      });
    } catch {
      // Redirect without preserving token; the signup page shows a generic unavailable-context message.
      destination.searchParams.set("context", "unavailable");
    }
  } else {
    destination.searchParams.set("context", "unavailable");
  }
  response.headers.set("Location", destination.toString());
  return response;
}
