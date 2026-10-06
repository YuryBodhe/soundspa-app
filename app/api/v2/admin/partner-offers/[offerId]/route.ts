import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { offerId } = await params;
  if (!uuidPattern.test(offerId)) return Response.json({ ok: false, code: "invalid_input", message: "Invalid Offer." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, code: "invalid_json", message: "Offer state is required." }, { status: 400 }); }
  if (typeof body !== "object" || body === null || typeof (body as { isActive?: unknown }).isActive !== "boolean") return Response.json({ ok: false, code: "invalid_input", message: "Offer state is invalid." }, { status: 400 });
  try {
    const { setPartnerOfferActive } = await import("../../../../../../db/v2/services/partnerOfferAdmin");
    const offer = await setPartnerOfferActive(offerId, (body as { isActive: boolean }).isActive);
    return Response.json({ ok: true, isActive: offer.isActive }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { PartnerOfferAdminError } = await import("../../../../../../db/v2/services/partnerOfferAdmin");
    if (error instanceof PartnerOfferAdminError) return Response.json({ ok: false, code: error.code, message: "Offer not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    console.error("[V2 partner offer admin] Offer state update failed.");
    return Response.json({ ok: false, code: "update_failed", message: "Offer state could not be updated." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
