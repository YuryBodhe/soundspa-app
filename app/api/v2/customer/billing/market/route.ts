import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";
import { fakeProviderIsEnabled } from "@/lib/v2/fakePaymentProvider";

export const dynamic = "force-dynamic";
const bodySchema = z.object({ locationId: z.string().uuid(), marketCode: z.string().length(2) }).strict();
const headers = authResponseHeaders();
const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return failure("request_not_allowed", 403);
  if (!fakeProviderIsEnabled(process.env, request)) return failure("unavailable", 404);
  const session = await getVerifiedCustomerPaymentSession(request);
  if (!session) return failure("unauthenticated", 401);
  try {
    const raw = await request.text();
    if (raw.length > 2048) return failure("invalid", 400);
    const input = bodySchema.parse(JSON.parse(raw));
    const { updateCustomerLocationMarket } = await import("@/db/v2/services/customerBilling");
    await updateCustomerLocationMarket({ userId: session.user.id, ...input });
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return failure("invalid", 400);
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      return failure(code, code === "not_authorized" ? 404 : code === "invalid_market" ? 400 : 409);
    }
    return failure("unavailable", 503);
  }
}
