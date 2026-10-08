import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";
import { fakeCheckoutRequestSchema, fakeProviderIsEnabled } from "@/lib/v2/fakePaymentProvider";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();

function failure(code: string, status: number) { return NextResponse.json({ error: code }, { status, headers }); }

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return failure("request_not_allowed", 403);
  if (!fakeProviderIsEnabled(process.env, request)) return failure("not_found", 404);
  try {
    const session = await getVerifiedCustomerPaymentSession(request);
    if (!session) return failure("unauthenticated_or_unverified", 401);
    const raw = await request.text();
    if (raw.length > 4096) return failure("invalid", 400);
    const input = fakeCheckoutRequestSchema.parse(JSON.parse(raw));
    const { createFakeProviderCheckout } = await import("@/db/v2/services/fakePaymentProvider");
    const checkout = await createFakeProviderCheckout({ authenticatedUserId: session.user.id, ...input });
    return NextResponse.json(checkout, { status: 201, headers });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return failure("invalid", 400);
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      const status = code === "not_authorized" ? 404 : code === "market_not_configured" || code === "route_unavailable" || code === "product_unavailable" ? 409 : code === "checkout_pending" ? 409 : 503;
      return failure(code, status);
    }
    console.error("[V2 Fake Provider] Checkout request failed.");
    return failure("unavailable", 503);
  }
}
