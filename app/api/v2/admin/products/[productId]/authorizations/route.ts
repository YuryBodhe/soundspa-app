import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../lib/v2/adminOperator";
import { ProductVisibilityAdminError } from "../../../../../../../db/v2/services/productVisibilityAdminValidation";

export const dynamic = "force-dynamic";

const grantSchema = z.object({ organizationId: z.string().uuid(), reason: z.string().trim().min(12).max(500) }).strict();

function responseFor(error: unknown) {
  if (error instanceof ProductVisibilityAdminError) {
    const status = error.code === "PRODUCT_NOT_FOUND" || error.code === "ORGANIZATION_NOT_FOUND" ? 404
      : error.code === "AUTHORIZATION_EXISTS" || error.code === "ORGANIZATION_ARCHIVED" ? 409
        : error.code === "NOT_AUTHORIZED" ? 401 : 400;
    const message = error.code === "PRODUCT_NOT_FOUND" ? "Product not found."
      : error.code === "ORGANIZATION_NOT_FOUND" ? "Organization not found."
        : error.code === "ORGANIZATION_ARCHIVED" ? "Archived Organizations cannot receive new purchase authorization."
          : error.code === "AUTHORIZATION_EXISTS" ? "This Organization already has active purchase authorization for the Product."
            : error.code === "INVALID_INPUT" ? "Provide a valid Organization and a reason of 12–500 characters."
              : "V2 operator authorization required.";
    return NextResponse.json({ ok: false, code: error.code, message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[V2 Product Authorization Admin] Authorization operation failed.");
  return NextResponse.json({ ok: false, code: "product_authorization_failed", message: "Purchase authorization could not be changed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ productId: string }> }) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  try {
    const { productId } = await context.params;
    const { listProductAuthorizationManagementData } = await import("../../../../../../../db/v2/services/productVisibilityAdmin");
    return NextResponse.json(await listProductAuthorizationManagementData(productId, request.headers.get("authorization")), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseFor(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
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
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_input", message: "Provide a valid Organization and reason." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { productId } = await context.params;
    const { grantProductPurchaseAuthorization } = await import("../../../../../../../db/v2/services/productVisibilityAdmin");
    const authorization = await grantProductPurchaseAuthorization({ ...parsed.data, productId, operatorAuthorization: request.headers.get("authorization") });
    return NextResponse.json({ ok: true, authorization }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseFor(error);
  }
}
