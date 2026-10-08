import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";
import { fakeCancellationRequestSchema, fakeProviderIsEnabled } from "@/lib/v2/fakePaymentProvider";

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
    const input = fakeCancellationRequestSchema.parse(JSON.parse(raw));
    const { cancelFakeProviderSubscription } = await import("@/db/v2/services/fakePaymentProvider");
    return NextResponse.json(await cancelFakeProviderSubscription({ authenticatedUserId: session.user.id, ...input }), { headers });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return failure("invalid", 400);
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      const status = code === "not_authorized" || code === "subscription_unavailable" ? 404 : 503;
      return failure(code, status);
    }
    console.error("[V2 Fake Provider] Cancellation request failed.");
    return failure("unavailable", 503);
  }
}
