import { revalidatePath } from "next/cache";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ ok: false, code: "invalid_json", message: "Type the Organization name to confirm deletion." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }

  try {
    const { organizationId } = await context.params;
    const confirmationName = body && typeof body === "object" && !Array.isArray(body) ? (body as { confirmationName?: unknown }).confirmationName : undefined;
    const { deleteOrganization } = await import("../../../../../../db/v2/services/organizationDeletion");
    const deleted = await deleteOrganization(organizationId, confirmationName);
    revalidatePath("/admin/ui");
    return Response.json({ ok: true, organization: { id: deleted.organizationId, name: deleted.organizationName }, removed: deleted.removed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const operation = error as { name?: unknown; code?: unknown; message?: unknown };
    if (operation?.name === "OrganizationDeletionError") {
      const notFound = operation.code === "not_found";
      return Response.json({ ok: false, code: operation.code, message: operation.message }, { status: notFound ? 404 : 409, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 organization administration] Organization deletion failed.");
    return Response.json({ ok: false, message: "Organization could not be deleted. Check its dependent records and retry." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
