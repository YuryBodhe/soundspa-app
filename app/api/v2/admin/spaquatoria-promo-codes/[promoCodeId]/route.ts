import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";
import { z } from "zod";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const configureSchema = z.object({ confirm: z.literal(true), durationDays: z.number().int().min(1).max(365), expiresAt: z.string().datetime({ offset: true }).nullable(), maxRedemptions: z.number().int().positive().max(2_147_483_647).nullable(), reason: z.string().trim().min(12).max(500) }).strict();
const revokeSchema = z.object({ confirm: z.literal(true), reason: z.string().trim().min(12).max(500) }).strict();
function statusFor(code: string) {
  if (code === "not_found") return 404;
  if (["redemption_limit_below_usage", "already_revoked"].includes(code)) return 409;
  if (code === "operator_unavailable") return 503;
  return 400;
}
function responseError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "unavailable";
  if (code === "unavailable") console.error("[V2 Spaquatoria promo admin] Update failed.");
  return Response.json({ ok: false, code }, { status: statusFor(code), headers: noStore });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ promoCodeId: string }> }) {
  const auth = operatorAuthStatus(request.headers.get("authorization"));
  if (auth !== 200) return operatorAuthResponse(auth);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required" }, { status: 403, headers: noStore });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type" }, { status: 415, headers: noStore });
  const { promoCodeId } = await params;
  if (!uuidPattern.test(promoCodeId)) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
    const input = configureSchema.parse(JSON.parse(raw));
    const { configureSpaquatoriaPromoCode } = await import("../../../../../../db/v2/services/spaquatoriaPromoCodes");
    return Response.json({ ok: true, result: await configureSpaquatoriaPromoCode(promoCodeId, input) }, { headers: noStore });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
    return responseError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ promoCodeId: string }> }) {
  const auth = operatorAuthStatus(request.headers.get("authorization"));
  if (auth !== 200) return operatorAuthResponse(auth);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required" }, { status: 403, headers: noStore });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type" }, { status: 415, headers: noStore });
  const { promoCodeId } = await params;
  if (!uuidPattern.test(promoCodeId)) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
    const input = revokeSchema.parse(JSON.parse(raw));
    const { revokeSpaquatoriaPromoCode } = await import("../../../../../../db/v2/services/spaquatoriaPromoCodes");
    return Response.json({ ok: true, result: await revokeSpaquatoriaPromoCode(promoCodeId, input) }, { headers: noStore });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
    return responseError(error);
  }
}
