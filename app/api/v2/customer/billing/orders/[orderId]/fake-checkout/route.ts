import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";
import { fakeProviderUiIsAvailable, fakeProviderIsEnabled } from "@/lib/v2/fakePaymentProvider";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();
const paramsSchema = z.object({ orderId: z.string().uuid() });
function failure(error: string, status: number) { return NextResponse.json({ error }, { status, headers }); }
function statusFor(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "unavailable";
  return { code, status: code === "not_authorized" ? 404 : code === "checkout_expired" ? 410 : code === "checkout_unavailable" || code === "checkout_pending" || code === "route_unavailable" || code === "order_stale" ? 409 : 503 };
}

async function authorizedRequest(request: Request) {
  if (!fakeProviderUiIsAvailable(process.env, request)) return { response: failure("not_found", 404) };
  const session = await getVerifiedCustomerPaymentSession(request);
  return session ? { session } : { response: failure("unauthenticated_or_unverified", 401) };
}

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const auth = await authorizedRequest(request);
  if ("response" in auth) return auth.response;
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return failure("not_found", 404);
  try {
    const { getFakeProviderBillingOrderCheckoutLink } = await import("@/db/v2/services/fakeBillingOrderProvider");
    return NextResponse.json(await getFakeProviderBillingOrderCheckoutLink({
      authenticatedUserId: auth.session.user.id, billingOrderId: parsed.data.orderId,
    }), { headers });
  } catch (error) {
    const result = statusFor(error);
    return failure(result.code, result.status);
  }
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!isSameOriginMutation(request)) return failure("request_not_allowed", 403);
  if (!fakeProviderIsEnabled(process.env, request)) return failure("not_found", 404);
  const session = await getVerifiedCustomerPaymentSession(request);
  if (!session) return failure("unauthenticated_or_unverified", 401);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return failure("invalid", 400);
  try {
    const { createFakeProviderBillingOrderCheckout } = await import("@/db/v2/services/fakeBillingOrderProvider");
    return NextResponse.json(await createFakeProviderBillingOrderCheckout({
      authenticatedUserId: session.user.id, billingOrderId: parsed.data.orderId,
    }), { headers });
  } catch (error) {
    const result = statusFor(error);
    return failure(result.code, result.status);
  }
}
