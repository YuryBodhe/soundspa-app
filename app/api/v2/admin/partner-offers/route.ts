import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  try {
    const { listPartnerOffers } = await import("../../../../../db/v2/services/partnerOfferAdmin");
    return Response.json(await listPartnerOffers(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[V2 partner offer admin] Listing failed.");
    return Response.json({ ok: false, code: "list_failed", message: "Offers could not be loaded." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type", message: "JSON request body required." }, { status: 415 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, code: "invalid_json", message: "Offer details are required." }, { status: 400 }); }
  if (typeof body !== "object" || body === null) return Response.json({ ok: false, code: "invalid_input", message: "Offer details are required." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.partnerId !== "string" || !uuidPattern.test(input.partnerId)) return Response.json({ ok: false, code: "invalid_input", message: "Select a valid Partner." }, { status: 400 });
  try {
    const { createPartnerOffer } = await import("../../../../../db/v2/services/partnerOfferAdmin");
    const offer = await createPartnerOffer({ partnerId: input.partnerId, code: input.code, name: input.name });
    return Response.json({ ok: true, offerId: offer.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { PartnerOfferAdminError } = await import("../../../../../db/v2/services/partnerOfferAdmin");
    if (error instanceof PartnerOfferAdminError) {
      const statusCode = error.code === "PARTNER_NOT_FOUND" ? 404 : error.code === "OFFER_CODE_EXISTS" ? 409 : 400;
      const message = error.code === "OFFER_CODE_EXISTS" ? "That Offer code already exists for this Partner." : error.code === "PARTNER_NOT_FOUND" ? "Partner not found." : "Enter a non-empty Offer code and name.";
      return Response.json({ ok: false, code: error.code, message }, { status: statusCode, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 partner offer admin] Offer creation failed.");
    return Response.json({ ok: false, code: "create_failed", message: "Offer could not be created." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
