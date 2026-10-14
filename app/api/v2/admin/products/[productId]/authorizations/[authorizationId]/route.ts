import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../../lib/v2/adminOperator";
import { ProductVisibilityAdminError } from "../../../../../../../../db/v2/services/productVisibilityAdminValidation";

export const dynamic = "force-dynamic";

const revokeSchema = z.object({ reason: z.string().trim().min(12).max(500), confirmed: z.literal(true) }).strict();

function responseFor(error: unknown) {
  if (error instanceof ProductVisibilityAdminError) {
    const status = error.code === "AUTHORIZATION_NOT_FOUND" ? 404
      : error.code === "AUTHORIZATION_REVOKED" ? 409
        : error.code === "NOT_AUTHORIZED" ? 401 : 400;
    const message = error.code === "AUTHORIZATION_NOT_FOUND" ? "Organization purchase authorization not found."
      : error.code === "AUTHORIZATION_REVOKED" ? "This authorization has already been revoked."
        : error.code === "CONFIRMATION_REQUIRED" ? "Confirm revocation before saving."
          : error.code === "INVALID_INPUT" ? "Provide a reason of 12–500 characters."
            : "V2 operator authorization required.";
    return NextResponse.json({ ok: false, code: error.code, message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[V2 Product Authorization Admin] Revocation failed.");
  return NextResponse.json({ ok: false, code: "product_authorization_failed", message: "Purchase authorization could not be revoked." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ productId: string; authorizationId: string }> }) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return NextResponse.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ ok: false, code: "invalid_content_type", message: "JSON request body required." }, { status: 415 });
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) return NextResponse.json({ ok: false, code: "invalid_input", message: "Authorization details are too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_json", message: "Authorization details are required." }, { status: 400 });
  }
  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_input", message: "Provide a reason and explicit confirmation." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { productId, authorizationId } = await context.params;
    const { revokeProductPurchaseAuthorization } = await import("../../../../../../../../db/v2/services/productVisibilityAdmin");
    const authorization = await revokeProductPurchaseAuthorization({ ...parsed.data, productId, authorizationId, operatorAuthorization: request.headers.get("authorization") });
    return NextResponse.json({ ok: true, authorization }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseFor(error);
  }
}
