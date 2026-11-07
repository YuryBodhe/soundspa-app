import { revalidatePath } from "next/cache";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../lib/v2/adminOperator";
import { OrganizationLifecycleError } from "../../../../../db/v2/services/organizationLifecycle";

export async function mutateOrganizationLifecycle(request: Request, context: { params: Promise<{ organizationId: string }> }, action: "archive" | "restore") {
  const authStatus = operatorAuthStatus(request.headers.get("authorization"));
  if (authStatus !== 200) return operatorAuthResponse(authStatus);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required", message: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type", message: "JSON request required." }, { status: 415, headers: { "Cache-Control": "no-store" } });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 2048) return Response.json({ ok: false, code: "invalid_request", message: "Organization lifecycle details are invalid." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ ok: false, code: "invalid_request", message: "Organization lifecycle details are invalid." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    body = JSON.parse(raw);
  }
  catch { return Response.json({ ok: false, code: "invalid_json", message: "Type the Organization name and provide a reason." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, code: "invalid_request", message: "Organization lifecycle details are invalid." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const input = body as { confirmationName?: unknown; reason?: unknown };
  if (Object.keys(body).some((key) => key !== "confirmationName" && key !== "reason") || typeof input.confirmationName !== "string" || input.confirmationName.length > 200 || typeof input.reason !== "string" || input.reason.trim().length < 12 || input.reason.trim().length > 500) {
    return Response.json({ ok: false, code: "invalid_request", message: "Type the exact Organization name and enter a reason between 12 and 500 characters." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { organizationId } = await context.params;
    const operator = process.env.V2_ADMIN_USERNAME ?? "";
    const { archiveOrganization, restoreOrganization } = await import("../../../../../db/v2/services/organizationLifecycle");
    const result = action === "archive"
      ? await archiveOrganization(organizationId, input.confirmationName, input.reason, operator)
      : await restoreOrganization(organizationId, input.confirmationName, input.reason, operator);
    revalidatePath("/admin/ui");
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OrganizationLifecycleError) {
      const status = error.code === "not_found" ? 404 : error.code === "database_conflict" ? 409 : 400;
      return Response.json({ ok: false, code: error.code, message: error.message }, { status, headers: { "Cache-Control": "no-store" } });
    }
    console.error(`[V2 organization administration] Organization ${action} failed.`);
    return Response.json({ ok: false, message: `Organization could not be ${action === "archive" ? "archived" : "restored"}.` }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
