import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  try {
    const { listRegistrationLinks } = await import("../../../../../db/v2/services/registrationLinks");
    return Response.json({ links: await listRegistrationLinks() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[V2 registration links] Listing failed.");
    return Response.json({ ok: false, code: "list_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, code: "same_origin_required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return Response.json({ ok: false, code: "invalid_content_type" }, { status: 415 });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });
    const body = JSON.parse(raw) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });
    const values = body as Record<string, unknown>;
    const { createRegistrationLink } = await import("../../../../../db/v2/services/registrationLinks");
    const created = await createRegistrationLink({
      reason: values.reason, expiresAt: values.expiresAt, maxRedemptions: values.maxRedemptions,
      publicOrigin: process.env.V2_PUBLIC_ORIGIN?.trim() || new URL(request.url).origin,
    });
    return Response.json({ ok: true, ...created }, { status: 201, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ ok: false, code: "invalid_json" }, { status: 400 });
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "invalid") return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "validation") return Response.json({ ok: false, code: "invalid_details" }, { status: 400 });
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "operator_unavailable") return Response.json({ ok: false, code: "operator_unavailable" }, { status: 503 });
    console.error("[V2 registration links] Creation failed.");
    return Response.json({ ok: false, code: "create_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
