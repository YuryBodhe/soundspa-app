import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../lib/v2/adminOperator";
import { z } from "zod";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const inputSchema = z.object({ durationDays: z.number().int().min(1).max(365), expiresAt: z.string().datetime({ offset: true }).nullable(), maxRedemptions: z.number().int().positive().max(2_147_483_647).nullable(), reason: z.string().trim().min(12).max(500) }).strict();
function errorResponse(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "invalid") return Response.json({ ok: false, code }, { status: 400, headers: noStore });
  if (code === "operator_unavailable") return Response.json({ ok: false, code }, { status: 503, headers: noStore });
  if (code === "inactive_configuration") return Response.json({ ok: false, code }, { status: 409, headers: noStore });
  console.error("[V2 Spaquatoria promo admin] Operation failed.");
  return Response.json({ ok: false, code: "unavailable" }, { status: 500, headers: noStore });
}

export async function GET(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  try {
    const { listSpaquatoriaPromoCodes } = await import("../../../../../db/v2/services/spaquatoriaPromoCodes");
    return Response.json({ promoCodes: await listSpaquatoriaPromoCodes() }, { headers: noStore });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required" }, { status: 403, headers: noStore });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type" }, { status: 415, headers: noStore });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
    const input = inputSchema.parse(JSON.parse(raw));
    const { createSpaquatoriaPromoCode } = await import("../../../../../db/v2/services/spaquatoriaPromoCodes");
    const result = await createSpaquatoriaPromoCode(input);
    return Response.json({ ok: true, ...result }, { status: 201, headers: { ...noStore, Pragma: "no-cache" } });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
    return errorResponse(error);
  }
}
