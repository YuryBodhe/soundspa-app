import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../lib/v2/adminOperator";
import { ProductVisibilityAdminError } from "../../../../../../../db/v2/services/productVisibilityAdminValidation";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  visibility: z.enum(["public", "private", "disabled"]),
  reason: z.string().trim().min(12).max(500),
  confirmed: z.literal(true),
}).strict();

function responseFor(error: unknown) {
  if (error instanceof ProductVisibilityAdminError) {
    const status = error.code === "PRODUCT_NOT_FOUND" ? 404 : error.code === "NOT_AUTHORIZED" ? 401 : 400;
    const message = error.code === "PRODUCT_NOT_FOUND" ? "Product not found."
      : error.code === "CONFIRMATION_REQUIRED" ? "Confirm the visibility change before saving."
        : error.code === "INVALID_INPUT" ? "Provide a valid visibility and a reason of 12–500 characters."
          : "V2 operator authorization required.";
    return NextResponse.json({ ok: false, code: error.code, message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[V2 Product Visibility Admin] Visibility update failed.");
  return NextResponse.json({ ok: false, code: "visibility_update_failed", message: "Product visibility could not be updated." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ productId: string }> }) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return NextResponse.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ ok: false, code: "invalid_content_type", message: "JSON request body required." }, { status: 415 });

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) return NextResponse.json({ ok: false, code: "invalid_input", message: "Visibility details are too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_json", message: "Visibility details are required." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_input", message: "Provide a valid visibility, reason, and confirmation." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const { productId } = await context.params;
    const { updateProductVisibility } = await import("../../../../../../../db/v2/services/productVisibilityAdmin");
    const result = await updateProductVisibility({ ...parsed.data, productId, operatorAuthorization: request.headers.get("authorization") });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseFor(error);
  }
}
