import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { getVerifiedCustomerPaymentSession } from "@/lib/v2/customerPaymentHttp";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();
const schema = z.object({ locationId: z.string().uuid(), code: z.string().trim().min(32).max(128) }).strict();
function failure(error: string, status: number) { return NextResponse.json({ error }, { status, headers }); }

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return failure("request_not_allowed", 403);
  const session = await getVerifiedCustomerPaymentSession(request);
  if (!session) return failure("unauthenticated_or_unverified", 401);
  try {
    const raw = await request.text();
    if (raw.length > 2048) return failure("invalid", 400);
    const input = schema.parse(JSON.parse(raw));
    const { redeemSpaquatoriaPromoCode } = await import("@/db/v2/services/spaquatoriaPromoCodes");
    const result = await redeemSpaquatoriaPromoCode({ authenticatedUserId: session.user.id, locationId: input.locationId, code: input.code });
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return failure("invalid", 400);
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "not_authorized" || code === "location_unavailable") return failure("location_unavailable", 404);
    if (code === "promo_unavailable") return failure("promo_unavailable", 404);
    console.error("[V2 Spaquatoria promo redemption] Request failed.");
    return failure("unavailable", 503);
  }
}
