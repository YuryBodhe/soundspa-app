import { NextResponse } from "next/server";
import { CUSTOMER_SESSION_COOKIE, authResponseHeaders } from "@/lib/v2/customerAuthCore";

export async function GET(request: Request) {
  try {
    const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
    const token = pair ? decodeURIComponent(pair.slice(CUSTOMER_SESSION_COOKIE.length + 1)) : null;
    if (!token) return NextResponse.json({ user: null }, { headers: authResponseHeaders() });
    const { getCustomerSession } = await import("@/db/v2/services/customerAuth");
    const row = await getCustomerSession(token);
    return NextResponse.json({ user: row ? { id: row.user.id, email: row.user.email, emailVerifiedAt: row.user.emailVerifiedAt?.toISOString() ?? null, preferredLocale: row.user.preferredLocale } : null }, { headers: authResponseHeaders() });
  } catch {
    return NextResponse.json({ user: null }, { headers: authResponseHeaders() });
  }
}
