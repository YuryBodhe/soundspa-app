import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { CUSTOMER_SESSION_COOKIE, authResponseHeaders } from "@/lib/v2/customerAuthCore";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Request not allowed" }, { status: 403, headers: authResponseHeaders() });
  try {
    const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
    const token = pair ? decodeURIComponent(pair.slice(CUSTOMER_SESSION_COOKIE.length + 1)) : null;
    if (token) {
      const { revokeCustomerSession } = await import("@/db/v2/services/customerAuth");
      await revokeCustomerSession(token);
    }
  } catch {
    // Always clear the browser cookie; never include credential material in an error.
  }
  const clear = `${CUSTOMER_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  return NextResponse.json({ ok: true }, { headers: authResponseHeaders({ "Set-Cookie": clear }) });
}
