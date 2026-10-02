import { revalidatePath } from "next/cache";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  try {
    const { deviceId } = await context.params;
    const { deleteDevice } = await import("../../../../../../db/v2/services/deviceAdministration");
    const deleted = await deleteDevice(deviceId);
    revalidatePath("/admin/ui");
    return Response.json({ ok: true, device: { id: deleted.id, label: deleted.label }, removed: deleted.removed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const operation = error as { name?: unknown; code?: unknown; message?: unknown };
    if (operation?.name === "DeviceAdministrationError") {
      const notFound = operation.code === "not_found";
      return Response.json({ ok: false, code: operation.code, message: operation.message }, { status: notFound ? 404 : 409, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 device administration] Device deletion failed.");
    return Response.json({ ok: false, message: "Device could not be deleted. Please retry." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
