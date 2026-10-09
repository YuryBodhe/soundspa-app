import { NextResponse } from "next/server";
import { z } from "zod";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";
import { fakeProviderUiIsAvailable } from "@/lib/v2/fakePaymentProvider";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();
const paramsSchema = z.object({ orderId: z.string().uuid() });

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!fakeProviderUiIsAvailable(process.env, request)) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  const session = await getVerifiedCustomerPaymentSession(request);
  if (!session) return NextResponse.json({ error: "unauthenticated_or_unverified" }, { status: 401, headers });
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  try {
    const { getCustomerBillingOrder } = await import("@/db/v2/services/billingOrderRead");
    return NextResponse.json(await getCustomerBillingOrder({
      authenticatedUserId: session.user.id, billingOrderId: parsed.data.orderId,
    }), { headers });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "unavailable";
    return NextResponse.json({ error: code === "not_found" ? "not_found" : "unavailable" }, {
      status: code === "not_found" ? 404 : 503, headers,
    });
  }
}
