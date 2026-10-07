import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../lib/v2/adminOperator";
import { ProductAdminError } from "../../../../../db/v2/services/productAdminValidation";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(2).max(80),
  kind: z.enum(["core", "partner", "addon"]),
  isActive: z.boolean(),
  channelIds: z.array(z.string().uuid()).max(250),
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof ProductAdminError) {
    const status = error.code === "PRODUCT_CODE_EXISTS" ? 409
      : error.code === "PRODUCT_NOT_FOUND" || error.code === "CHANNEL_NOT_FOUND" ? 404 : 400;
    const message = error.code === "PRODUCT_CODE_EXISTS" ? "That Product code is already in use."
      : error.code === "CHANNEL_NOT_FOUND" ? "One or more selected Channels are unavailable."
        : error.code === "PRODUCT_NOT_FOUND" ? "Product not found." : "Check the Product details and try again.";
    return NextResponse.json({ ok: false, code: error.code, message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[V2 Product Admin] Product operation failed.");
  return NextResponse.json({ ok: false, code: "product_operation_failed", message: "The Product could not be saved." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  try {
    const { listProductManagementData } = await import("../../../../../db/v2/services/productAdmin");
    return NextResponse.json(await listProductManagementData(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[V2 Product Admin] Product list failed.");
    return NextResponse.json({ ok: false, code: "product_list_failed", message: "Products could not be loaded." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return NextResponse.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ ok: false, code: "invalid_content_type", message: "JSON request body required." }, { status: 415 });

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 65_536) return NextResponse.json({ ok: false, code: "invalid_input", message: "Product details are too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_json", message: "Product details are required." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_input", message: "Check the Product details and try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const { createProduct } = await import("../../../../../db/v2/services/productAdmin");
    const product = await createProduct(parsed.data);
    return NextResponse.json({ ok: true, product }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
