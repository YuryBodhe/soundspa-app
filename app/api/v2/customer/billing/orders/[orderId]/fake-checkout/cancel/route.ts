import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";
import { fakeProviderIsEnabled } from "@/lib/v2/fakePaymentProvider";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();
const paramsSchema = z.object({ orderId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "request_not_allowed" }, { status: 403, headers });
  if (!fakeProviderIsEnabled(process.env, request)) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  const session = await getVerifiedCustomerPaymentSession(request);
  if (!session) return NextResponse.json({ error: "unauthenticated_or_unverified" }, { status: 401, headers });
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400, headers });
  try {
    const { cancelFakeProviderBillingOrderCheckout } = await import("@/db/v2/services/fakeBillingOrderProvider");
    return NextResponse.json(await cancelFakeProviderBillingOrderCheckout({
      authenticatedUserId: session.user.id, billingOrderId: parsed.data.orderId,
    }), { headers });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "unavailable";
    const status = code === "not_authorized" || code === "checkout_unavailable" ? 404 : code === "checkout_expired" ? 410 : 503;
    return NextResponse.json({ error: code }, { status, headers });
  }
}
