import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";
import { fakeProviderIsEnabled, fakeProviderUiIsAvailable } from "@/lib/v2/fakePaymentProvider";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();
const requestSchema = z.object({
  organizationId: z.string().uuid(),
  lines: z.array(z.object({ locationId: z.string().uuid(), productId: z.string().uuid(), durationMonths: z.number().int().min(1).max(12) }).strict()).min(1).max(100),
}).strict();

function failure(error: string, status: number) { return NextResponse.json({ error }, { status, headers }); }

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return failure("request_not_allowed", 403);
  if (!fakeProviderIsEnabled(process.env, request)) return failure("not_found", 404);
  const session = await getVerifiedCustomerPaymentSession(request);
  if (!session) return failure("unauthenticated_or_unverified", 401);
  try {
    const raw = await request.text();
    if (raw.length > 32_768) return failure("invalid", 400);
    const body = requestSchema.parse(JSON.parse(raw));
    const { createPrepaidBillingOrder } = await import("@/db/v2/services/billingOrders");
    const order = await createPrepaidBillingOrder({ authenticatedUserId: session.user.id, ...body });
    return NextResponse.json({ order }, { status: 201, headers });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return failure("invalid", 400);
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      const status = code === "not_authorized" ? 404 : code === "invalid_request" || code === "duplicate_line" ? 400 : 409;
      return failure(code, status);
    }
    return failure("unavailable", 503);
  }
}

export async function GET(request: Request) {
  if (!fakeProviderUiIsAvailable(process.env, request)) return failure("not_found", 404);
  const session = await getVerifiedCustomerPaymentSession(request);
  if (!session) return failure("unauthenticated_or_unverified", 401);
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (cursor && cursor.length > 512)) return failure("invalid", 400);
  try {
    const { listCustomerBillingOrders } = await import("@/db/v2/services/billingOrderRead");
    return NextResponse.json(await listCustomerBillingOrders({ authenticatedUserId: session.user.id, limit, cursor }), { headers });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "invalid_cursor" || error.code === "not_found")) {
      return failure(error.code === "invalid_cursor" ? "invalid" : "unavailable", error.code === "invalid_cursor" ? 400 : 503);
    }
    return failure("unavailable", 503);
  }
}
