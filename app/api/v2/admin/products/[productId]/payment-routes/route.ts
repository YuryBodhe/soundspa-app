import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../lib/v2/adminOperator";
import { PaymentRouteAdminError } from "../../../../../../../db/v2/services/paymentRouteAdminValidation";

export const dynamic = "force-dynamic";
const createSchema = z.object({
  marketCode: z.string().regex(/^[A-Z]{2}$/),
  providerCode: z.string().min(1).max(80),
  externalReference: z.string().trim().min(1).max(255),
  displayOrder: z.number().int().min(0).max(2_147_483_647),
  reason: z.string().trim().min(12).max(500),
}).strict();

function responseFor(error: unknown) {
  if (error instanceof PaymentRouteAdminError) {
    const code = error.code;
    const status = code === "NOT_AUTHORIZED" ? 401 : code === "PRODUCT_NOT_FOUND" || code === "ROUTE_NOT_FOUND" ? 404
      : code === "ROUTE_IDENTITY_EXISTS" ? 409 : 400;
    const message = code === "PRODUCT_NOT_FOUND" ? "Product not found."
      : code === "ROUTE_NOT_FOUND" ? "Payment route not found."
        : code === "ROUTE_IDENTITY_EXISTS" ? "That payment route already exists."
          : code === "PROVIDER_UNAVAILABLE" ? "This payment provider is not available for route management."
            : code === "ROUTE_CONFIGURATION_UNSUPPORTED" ? "This provider does not support the selected market."
              : code === "CONFIRMATION_REQUIRED" ? "Confirm enabling this payment route."
                : code === "NOT_AUTHORIZED" ? "V2 operator authorization required."
                  : "Check the payment route details and reason.";
    return NextResponse.json({ ok: false, code: code ?? "invalid_input", message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[V2 Payment Route Admin] Route operation failed.");
  return NextResponse.json({ ok: false, code: "payment_route_operation_failed", message: "The payment route could not be saved." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

async function parseJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return { error: NextResponse.json({ ok: false, code: "invalid_content_type", message: "JSON request body required." }, { status: 415 }) };
  try {
    const text = await request.text();
    if (text.length > 16_384) return { error: NextResponse.json({ ok: false, code: "invalid_input", message: "Payment route details are too large." }, { status: 413 }) };
    return { body: JSON.parse(text) as unknown };
  } catch {
    return { error: NextResponse.json({ ok: false, code: "invalid_json", message: "Payment route details are required." }, { status: 400 }) };
  }
}

export async function GET(request: Request, context: { params: Promise<{ productId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  try {
    const { productId } = await context.params;
    const { listProductPaymentRoutes } = await import("../../../../../../../db/v2/services/paymentRouteAdmin");
    return NextResponse.json(await listProductPaymentRoutes({ productId, operatorAuthorization: request.headers.get("authorization") }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseFor(error); }
}

export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return NextResponse.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const parsedBody = await parseJson(request);
  if (parsedBody.error) return parsedBody.error;
  const parsed = createSchema.safeParse(parsedBody.body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_input", message: "Check the market, provider, reference, priority, and reason." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { productId } = await context.params;
    const { createProductPaymentRoute } = await import("../../../../../../../db/v2/services/paymentRouteAdmin");
    const result = await createProductPaymentRoute({ ...parsed.data, productId, operatorAuthorization: request.headers.get("authorization") });
    return NextResponse.json({ ok: true, ...result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseFor(error); }
}
