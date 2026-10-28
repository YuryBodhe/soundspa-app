import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const confirmationSchema = z.object({ amountMinor: z.string().regex(/^[1-9]\d{0,18}$/), currency: z.string().regex(/^[A-Z]{3}$/),
  bankTransactionReference: z.string().trim().min(1).max(200), actualPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(12).max(500),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return NextResponse.json({ ok: false, code: "same_origin_required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ ok: false, code: "invalid_content_type" }, { status: 415 });
  let raw: string;
  try { raw = await request.text(); } catch { return NextResponse.json({ ok: false, code: "invalid_json" }, { status: 400 }); }
  if (raw.length > 8192) return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, code: "invalid_json" }, { status: 400 }); }
  const parsed = confirmationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { orderId } = await context.params;
    const { confirmManualBankTransferPayment } = await import("../../../../../../../../db/v2/services/manualBillingAdmin");
    const result = await confirmManualBankTransferPayment({ ...parsed.data, orderId, operatorAuthorization: request.headers.get("authorization") });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code) {
      const statusCode = code === "not_authorized" ? 401 : code === "not_found" ? 404 : code === "bank_reference_conflict" || code === "payment_conflict" ? 409 : 400;
      return NextResponse.json({ ok: false, code }, { status: statusCode, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 admin billing] Payment confirmation failed.");
    return NextResponse.json({ ok: false, code: "payment_confirmation_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
