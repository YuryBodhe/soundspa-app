import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { SIGNUP_CONTEXT_COOKIE, allowAuthRequest, authEmailUrl, authResponseHeaders, clientRateKey, normalizeCustomerEmail, resolveAuthLocale } from "@/lib/v2/customerAuthCore";
import { renderCustomerAuthEmail } from "@/lib/v2/customerAuthEmails";
import { ResendCustomerMailSender } from "@/lib/v2/customerMail";
import { sha256 } from "@/lib/v2/customerAuthCore";

const generic = { ok: true };
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Request not allowed" }, { status: 403, headers: authResponseHeaders() });
  if (!allowAuthRequest(`signup:${clientRateKey(request)}`)) return NextResponse.json(generic, { status: 202, headers: authResponseHeaders() });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return NextResponse.json({ code: "invalid_request" }, { status: 400, headers: authResponseHeaders() });
    const body = JSON.parse(raw) as { email?: unknown; locale?: unknown; partnerContext?: unknown };
    const email = normalizeCustomerEmail(body.email);
    if (!email) return NextResponse.json({ code: "invalid_email" }, { status: 400, headers: authResponseHeaders() });
    const locale = resolveAuthLocale(body.locale, request.headers.get("accept-language"));
    const contextCookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SIGNUP_CONTEXT_COOKIE}=`))?.slice(SIGNUP_CONTEXT_COOKIE.length + 1);
    const contextTokenHash = contextCookie ? sha256(decodeURIComponent(contextCookie)) : body.partnerContext === true ? "invalid" : null;
    const { createSignupAuthRequest } = await import("@/db/v2/services/customerAuth");
    const issued = await createSignupAuthRequest({ email, locale, contextTokenHash });
    if (issued) {
      try {
        const message = renderCustomerAuthEmail(issued.purpose, locale, authEmailUrl(request, issued.token));
        await new ResendCustomerMailSender().send({ to: email, message });
      } catch {
        // Deliberately avoid logging addresses, tokens, provider responses, or invite context.
      }
    }
    return NextResponse.json(generic, { status: 202, headers: authResponseHeaders() });
  } catch {
    return NextResponse.json(generic, { status: 202, headers: authResponseHeaders() });
  }
}
