import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, { params }: { params: Promise<{ offerId: string; grantId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { offerId, grantId } = await params;
  if (!uuidPattern.test(offerId) || !uuidPattern.test(grantId)) return Response.json({ ok: false, code: "invalid_input", message: "Invalid grant target." }, { status: 400 });
  try {
    const { removePartnerOfferGrant } = await import("../../../../../../../../db/v2/services/partnerOfferAdmin");
    await removePartnerOfferGrant(offerId, grantId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { PartnerOfferAdminError } = await import("../../../../../../../../db/v2/services/partnerOfferAdmin");
    if (error instanceof PartnerOfferAdminError) {
      const locked = error.code === "GRANTS_LOCKED";
      return Response.json({ ok: false, code: error.code, message: locked ? "Grants are locked because this Offer has issued Invites. Create a new Offer to change its composition." : "Grant or Offer not found." }, { status: locked ? 409 : 404, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 partner offer admin] Grant removal failed.");
    return Response.json({ ok: false, code: "remove_failed", message: "Grant could not be removed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
