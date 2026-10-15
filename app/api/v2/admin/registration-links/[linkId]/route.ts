import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";

export async function PATCH(request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type" }, { status: 415 });
  const { linkId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(linkId)) return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });
    const body = JSON.parse(raw) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });
    const values = body as Record<string, unknown>;
    if (values.confirm !== true) return Response.json({ ok: false, code: "confirmation_required" }, { status: 400 });
    const { disableRegistrationLink } = await import("../../../../../../db/v2/services/registrationLinks");
    return Response.json({ ok: true, result: await disableRegistrationLink(linkId, { reason: values.reason }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ ok: false, code: "invalid_json" }, { status: 400 });
    const code = error && typeof error === "object" && "code" in error ? (error as { code: string }).code : "";
    if (code === "invalid") return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });
    if (code === "operator_unavailable") return Response.json({ ok: false, code }, { status: 503 });
    if (code === "not_found") return Response.json({ ok: false, code }, { status: 404 });
    console.error("[V2 registration links] Disable failed.");
    return Response.json({ ok: false, code: "disable_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
