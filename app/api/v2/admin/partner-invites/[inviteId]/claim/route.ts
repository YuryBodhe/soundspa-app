import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: noStore });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type", message: "JSON request body required." }, { status: 415, headers: noStore });

  const { inviteId } = await params;
  if (!uuidPattern.test(inviteId)) return Response.json({ ok: false, code: "invalid_input", message: "Invalid Invite." }, { status: 400, headers: noStore });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, code: "invalid_json", message: "A Location is required." }, { status: 400, headers: noStore }); }
  const locationId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).locationId : null;
  if (typeof locationId !== "string" || !uuidPattern.test(locationId)) return Response.json({ ok: false, code: "invalid_location", message: "Select a valid Location." }, { status: 400, headers: noStore });

  try {
    const { adminClaimPartnerInvite } = await import("../../../../../../../db/v2/services/partnerInviteClaims");
    const result = await adminClaimPartnerInvite({ inviteId, locationId });
    return Response.json({ ok: true, result }, { headers: noStore });
  } catch (error) {
    const { PartnerInviteClaimError } = await import("../../../../../../../db/v2/services/partnerInviteClaims");
    if (error instanceof PartnerInviteClaimError) {
      const messages: Record<typeof error.code, string> = {
        INVITE_UNAVAILABLE: "This Invite is unavailable.",
        LOCATION_UNAVAILABLE: "This Location is unavailable.",
        OFFER_INACTIVE: "The Invite Offer is inactive.",
        PARTNER_INACTIVE: "The Invite Partner is inactive.",
        PRODUCT_INACTIVE: "A Product granted by this Offer is inactive.",
        MAX_CLAIMS_EXHAUSTED: "This Invite has reached its claim limit.",
        INVALID_OFFER_CONFIGURATION: "The Offer configuration cannot be claimed.",
      };
      const status = error.code === "INVITE_UNAVAILABLE" || error.code === "LOCATION_UNAVAILABLE" ? 404 : 409;
      return Response.json({ ok: false, code: error.code, message: messages[error.code] }, { status, headers: noStore });
    }
    console.error("[V2 partner invite admin] Admin claim failed.");
    return Response.json({ ok: false, code: "claim_failed", message: "Invite could not be claimed for this Location." }, { status: 500, headers: noStore });
  }
}
