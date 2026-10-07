import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { allowAuthRequest, authEmailUrl, authResponseHeaders, clientRateKey, normalizeCustomerEmail, resolveAuthLocale } from "@/lib/v2/customerAuthCore";
import { renderCustomerAuthEmail } from "@/lib/v2/customerAuthEmails";
import { ResendCustomerMailSender } from "@/lib/v2/customerMail";

const generic = { ok: true };
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Request not allowed" }, { status: 403, headers: authResponseHeaders() });
  if (!allowAuthRequest(`login:${clientRateKey(request)}`)) return NextResponse.json(generic, { status: 202, headers: authResponseHeaders() });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return NextResponse.json({ code: "invalid_request" }, { status: 400, headers: authResponseHeaders() });
    const body = JSON.parse(raw) as { email?: unknown; locale?: unknown };
    const email = normalizeCustomerEmail(body.email);
    if (!email) return NextResponse.json({ code: "invalid_email" }, { status: 400, headers: authResponseHeaders() });
    const locale = resolveAuthLocale(body.locale, request.headers.get("accept-language"));
    const { createLoginAuthRequest } = await import("@/db/v2/services/customerAuth");
    const issued = await createLoginAuthRequest({ email, locale });
    if (issued) {
      try {
        await new ResendCustomerMailSender().send({ to: email, message: renderCustomerAuthEmail("login_link", locale, authEmailUrl(request, issued.token)) });
      } catch {
        // Keep account and provider details out of logs and responses.
      }
    }
    return NextResponse.json(generic, { status: 202, headers: authResponseHeaders() });
  } catch {
    return NextResponse.json(generic, { status: 202, headers: authResponseHeaders() });
  }
}
