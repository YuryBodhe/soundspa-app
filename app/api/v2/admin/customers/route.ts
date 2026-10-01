import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, code: "invalid_json", message: "Customer and Location details are required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const { createCustomerWithFirstLocation, CustomerProvisioningError } = await import("../../../../../db/v2/services/customerProvisioning");
    const created = await createCustomerWithFirstLocation(body);
    return Response.json({
      ok: true,
      organizationId: created.organization.id,
      locationId: created.location.id,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const provisioningError = error as { name?: unknown; code?: unknown; message?: unknown };
    if (provisioningError?.name === "CustomerProvisioningError" && (provisioningError.code === "validation" || provisioningError.code === "slug_conflict")) {
      const status = provisioningError.code === "slug_conflict" ? 409 : 400;
      const message = typeof provisioningError.message === "string" ? provisioningError.message : "Customer and Location details are invalid.";
      return Response.json({ ok: false, code: provisioningError.code, message }, { status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 customer provisioning] Provisioning transaction failed.");
    return Response.json({ ok: false, code: "provisioning_failed", message: "Customer and Location could not be created. Please review the details and try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
