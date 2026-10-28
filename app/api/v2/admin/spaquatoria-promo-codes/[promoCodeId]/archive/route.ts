import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "@/lib/v2/adminOperator";
import { z } from "zod";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const schema = z.object({ confirm: z.literal(true), reason: z.string().trim().min(12).max(500) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ promoCodeId: string }> }) {
  const auth = operatorAuthStatus(request.headers.get("authorization"));
  if (auth !== 200) return operatorAuthResponse(auth);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required" }, { status: 403, headers: noStore });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type" }, { status: 415, headers: noStore });
  const { promoCodeId } = await params;
  if (!uuidPattern.test(promoCodeId)) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
    const input = schema.parse(JSON.parse(raw));
    const { archiveSpaquatoriaPromoCode } = await import("@/db/v2/services/spaquatoriaPromoCodes");
    return Response.json({ ok: true, result: await archiveSpaquatoriaPromoCode(promoCodeId, input) }, { headers: noStore });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError || (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "invalid")) {
      return Response.json({ ok: false, code: "invalid" }, { status: 400, headers: noStore });
    }
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "unavailable";
    if (code === "not_found") return Response.json({ ok: false, code }, { status: 404, headers: noStore });
    if (code === "operator_unavailable") return Response.json({ ok: false, code }, { status: 503, headers: noStore });
    console.error("[V2 Spaquatoria promo admin] Archive failed.");
    return Response.json({ ok: false, code: "unavailable" }, { status: 500, headers: noStore });
  }
}
