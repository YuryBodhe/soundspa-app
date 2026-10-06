import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { offerId } = await params;
  if (!uuidPattern.test(offerId)) return Response.json({ ok: false, code: "invalid_input", message: "Invalid Offer." }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, code: "invalid_json", message: "Grant details are required." }, { status: 400 }); }
  if (typeof body !== "object" || body === null) return Response.json({ ok: false, code: "invalid_input", message: "Grant details are required." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.productId !== "string" || !uuidPattern.test(input.productId)) return Response.json({ ok: false, code: "invalid_input", message: "Select a valid Product." }, { status: 400 });
  try {
    const { addPartnerOfferGrant } = await import("../../../../../../../db/v2/services/partnerOfferAdmin");
    await addPartnerOfferGrant({ offerId, productId: input.productId, grantType: input.grantType, durationDays: input.durationDays });
    return Response.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { PartnerOfferAdminError } = await import("../../../../../../../db/v2/services/partnerOfferAdmin");
    if (error instanceof PartnerOfferAdminError) {
      const statusCode = error.code === "OFFER_NOT_FOUND" || error.code === "PRODUCT_NOT_FOUND" ? 404 : error.code === "GRANT_ALREADY_EXISTS" || error.code === "GRANTS_LOCKED" ? 409 : 400;
      const message = error.code === "GRANTS_LOCKED" ? "Grants are locked because this Offer has issued Invites. Create a new Offer to change its composition." : error.code === "GRANT_ALREADY_EXISTS" ? "This Product and grant type are already configured." : error.code === "PRODUCT_NOT_FOUND" ? "Product not found." : error.code === "OFFER_NOT_FOUND" ? "Offer not found." : "Grant configuration is invalid.";
      return Response.json({ ok: false, code: error.code, message }, { status: statusCode, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 partner offer admin] Grant creation failed.");
    return Response.json({ ok: false, code: "create_failed", message: "Grant could not be added." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
