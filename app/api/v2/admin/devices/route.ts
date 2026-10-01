import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ ok: false, code: "invalid_json", message: "Device name and Location are required." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, code: "validation", message: "Device name and Location are required." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  let publicUrl: URL;
  try {
    publicUrl = new URL(process.env.V2_PUBLIC_ORIGIN?.trim() || new URL(request.url).origin);
    if (publicUrl.username || publicUrl.password || (process.env.NODE_ENV === "production" && publicUrl.protocol !== "https:")) throw new Error("unsafe public origin");
  } catch {
    return Response.json({ ok: false, code: "origin_unavailable", message: "Device activation is not configured safely." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const { createDeviceWithActivation, DeviceProvisioningError } = await import("../../../../../db/v2/services/deviceProvisioning");
    const created = await createDeviceWithActivation(body as { locationId?: unknown; name?: unknown });
    const activationUrl = new URL(`/activate-device/${created.activationToken}`, publicUrl.origin).toString();
    return Response.json({ ok: true, device: created.device, activationUrl, expiresAt: created.expiresAt.toISOString() }, { status: 201, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const provisioningError = error as { name?: unknown; code?: unknown; message?: unknown };
    if (provisioningError?.name === "DeviceProvisioningError") {
      const status = provisioningError.code === "validation" ? 400 : provisioningError.code === "location_unavailable" ? 404 : 400;
      return Response.json({ ok: false, code: provisioningError.code, message: provisioningError.message }, { status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 device provisioning] Device creation failed.");
    return Response.json({ ok: false, code: "provisioning_failed", message: "Device could not be created. Please try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
