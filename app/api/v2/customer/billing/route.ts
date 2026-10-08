import { NextResponse } from "next/server";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";
import { fakeProviderUiIsAvailable } from "@/lib/v2/fakePaymentProvider";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = authResponseHeaders();
  if (!fakeProviderUiIsAvailable(process.env, request)) return NextResponse.json({ error: "unavailable" }, { status: 404, headers });
  const session = await getVerifiedCustomerPaymentSession(request);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  try {
    const { listCustomerBilling } = await import("@/db/v2/services/customerBilling");
    return NextResponse.json(await listCustomerBilling(session.user.id), { headers });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
}
