import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  const { offerId } = await params;
  if (!uuidPattern.test(offerId)) return Response.json({ ok: false, code: "invalid_input", message: "Invalid Offer." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { listPartnerInvites } = await import("../../../../../../../db/v2/services/partnerOfferAdmin");
    return Response.json({ invites: await listPartnerInvites(offerId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[V2 partner invite admin] Listing failed.");
    return Response.json({ ok: false, code: "list_failed", message: "Invites could not be loaded." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type", message: "JSON request body required." }, { status: 415, headers: { "Cache-Control": "no-store" } });
  const { offerId } = await params;
  if (!uuidPattern.test(offerId)) return Response.json({ ok: false, code: "invalid_input", message: "Invalid Offer." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, code: "invalid_json", message: "Invite options are required." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  if (typeof body !== "object" || body === null) return Response.json({ ok: false, code: "invalid_input", message: "Invite options are required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const input = body as Record<string, unknown>;
  try {
    const { createPartnerInvite } = await import("../../../../../../../db/v2/services/partnerOfferAdmin");
    const created = await createPartnerInvite(offerId, { maxClaims: input.maxClaims, expiresAt: input.expiresAt });
    return Response.json({ ok: true, invite: created.invite, token: created.token }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { PartnerOfferAdminError } = await import("../../../../../../../db/v2/services/partnerOfferAdmin");
    if (error instanceof PartnerOfferAdminError) {
      const unavailableCodes = new Set(["OFFER_NOT_FOUND", "PARTNER_NOT_FOUND"]);
      const conflictCodes = new Set(["OFFER_INACTIVE", "PARTNER_INACTIVE", "OFFER_HAS_NO_GRANTS", "PRODUCT_INACTIVE"]);
      const statusCode = unavailableCodes.has(error.code) ? 404 : conflictCodes.has(error.code) ? 409 : 400;
      const messages: Record<string, string> = {
        OFFER_NOT_FOUND: "Offer not found.",
        PARTNER_NOT_FOUND: "Partner not found.",
        OFFER_INACTIVE: "Activate the Offer before issuing an Invite.",
        PARTNER_INACTIVE: "Activate the Partner before issuing an Invite.",
        OFFER_HAS_NO_GRANTS: "Add at least one Product grant before issuing an Invite.",
        PRODUCT_INACTIVE: "All Products in the Offer grants must be active before issuing an Invite.",
        INVALID_MAX_CLAIMS: "Claims must be unlimited or a positive whole number.",
        INVALID_EXPIRY: "Expiry must be a valid future date and time.",
      };
      return Response.json({ ok: false, code: error.code, message: messages[error.code] ?? "Invite options are invalid." }, { status: statusCode, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 partner invite admin] Invite creation failed.");
    return Response.json({ ok: false, code: "create_failed", message: "Invite could not be created." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
