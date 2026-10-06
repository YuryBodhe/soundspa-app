import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { inviteId } = await params;
  if (!uuidPattern.test(inviteId)) return Response.json({ ok: false, code: "invalid_input", message: "Invalid Invite." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { revokePartnerInvite } = await import("../../../../../../db/v2/services/partnerOfferAdmin");
    await revokePartnerInvite(inviteId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { PartnerOfferAdminError } = await import("../../../../../../db/v2/services/partnerOfferAdmin");
    if (error instanceof PartnerOfferAdminError && error.code === "INVITE_NOT_FOUND") return Response.json({ ok: false, code: error.code, message: "Invite not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    console.error("[V2 partner invite admin] Revocation failed.");
    return Response.json({ ok: false, code: "revoke_failed", message: "Invite could not be revoked." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
