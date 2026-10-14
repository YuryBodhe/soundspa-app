import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../../lib/v2/adminOperator";
import { PaymentRouteAdminError } from "../../../../../../../../db/v2/services/paymentRouteAdminValidation";

export const dynamic = "force-dynamic";
const reason = z.string().trim().min(12).max(500);
const changeSchema = z.union([
  z.object({ isEnabled: z.literal(true), confirmed: z.literal(true), reason }).strict(),
  z.object({ isEnabled: z.literal(false), reason }).strict(),
  z.object({ displayOrder: z.number().int().min(0).max(2_147_483_647), reason }).strict(),
]);

function responseFor(error: unknown) {
  if (error instanceof PaymentRouteAdminError) {
    const code = error.code;
    const status = code === "NOT_AUTHORIZED" ? 401 : code === "PRODUCT_NOT_FOUND" || code === "ROUTE_NOT_FOUND" ? 404 : 400;
    const message = code === "PRODUCT_NOT_FOUND" ? "Product not found."
      : code === "ROUTE_NOT_FOUND" ? "Payment route not found."
        : code === "PROVIDER_UNAVAILABLE" ? "The provider must be enabled and correctly configured before enabling this route."
          : code === "CONFIRMATION_REQUIRED" ? "Confirm enabling this payment route."
            : code === "NOT_AUTHORIZED" ? "V2 operator authorization required."
              : "Check the route change and provide a valid reason.";
    return NextResponse.json({ ok: false, code: code ?? "invalid_input", message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[V2 Payment Route Admin] Route update failed.");
  return NextResponse.json({ ok: false, code: "payment_route_update_failed", message: "The payment route could not be updated." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ productId: string; routeId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return NextResponse.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ ok: false, code: "invalid_content_type", message: "JSON request body required." }, { status: 415 });
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) return NextResponse.json({ ok: false, code: "invalid_input", message: "Payment route details are too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return NextResponse.json({ ok: false, code: "invalid_json", message: "Payment route details are required." }, { status: 400 }); }
  const parsed = changeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_input", message: "Provide one route change, a valid reason, and confirmation when enabling." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { productId, routeId } = await context.params;
    const { updateProductPaymentRoute } = await import("../../../../../../../../db/v2/services/paymentRouteAdmin");
    const result = await updateProductPaymentRoute({ ...parsed.data, productId, routeId, operatorAuthorization: request.headers.get("authorization") });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseFor(error); }
}
