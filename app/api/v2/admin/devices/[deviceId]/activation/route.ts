import { revalidatePath } from "next/cache";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  let publicOrigin: string;
  try {
    const configured = process.env.V2_PUBLIC_ORIGIN?.trim() || new URL(request.url).origin;
    const parsed = new URL(configured);
    if (parsed.username || parsed.password || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) throw new Error("unsafe origin");
    publicOrigin = parsed.origin;
  } catch {
    return Response.json({ ok: false, code: "origin_unavailable", message: "Activation links are not configured safely." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const { deviceId } = await context.params;
    const { reissueDeviceActivation } = await import("../../../../../../../db/v2/services/deviceAdministration");
    const issued = await reissueDeviceActivation(deviceId);
    const activationUrl = new URL(`/activate-device/${issued.activationToken}`, publicOrigin).toString();
    revalidatePath("/admin/ui");
    return Response.json({ ok: true, activationUrl, expiresAt: issued.expiresAt.toISOString() }, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    const operation = error as { name?: unknown; code?: unknown; message?: unknown };
    if (operation?.name === "DeviceAdministrationError") {
      const notFound = operation.code === "not_found";
      return Response.json({ ok: false, code: operation.code, message: operation.message }, { status: notFound ? 404 : 409, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 device administration] Activation link reissue failed.");
    return Response.json({ ok: false, message: "A new activation link could not be issued." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
