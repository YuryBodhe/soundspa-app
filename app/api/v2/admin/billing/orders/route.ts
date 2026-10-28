import { NextResponse } from "next/server";
import { z } from "zod";
import { MANUAL_BANK_TRANSFER_CURRENCIES } from "../../../../../../db/v2/services/manualBillingModel";
import { isSameOriginMutation, operatorAuthResponse, operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const line = z.object({ locationId: z.string().uuid(), productId: z.string().uuid() }).strict();
export const createManualBillingOrderSchema = z.object({
  organizationId: z.string().uuid(), lines: z.array(line).min(1).max(1000),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEndExclusive: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalAmountMinor: z.string().regex(/^[1-9]\d{0,18}$/), currency: z.enum(MANUAL_BANK_TRANSFER_CURRENCIES),
  invoiceNumber: z.string().trim().min(1).max(120), invoiceIssuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentDueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(12).max(500),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
}).strict();

function postgresCode(error: unknown): string | undefined {
  const seen = new Set<object>(); let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current); const row = current as { code?: unknown; cause?: unknown };
    if (typeof row.code === "string") return row.code;
    current = row.cause;
  }
  return undefined;
}

export async function POST(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return NextResponse.json({ ok: false, code: "same_origin_required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return NextResponse.json({ ok: false, code: "invalid_content_type" }, { status: 415 });
  let raw: string;
  try { raw = await request.text(); } catch { return NextResponse.json({ ok: false, code: "invalid_json" }, { status: 400 }); }
  if (raw.length > 131_072) return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, code: "invalid_json" }, { status: 400 }); }
  const parsed = createManualBillingOrderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const { createManualBankTransferBillingOrder } = await import("../../../../../../db/v2/services/billingOrders");
    const result = await createManualBankTransferBillingOrder({ ...parsed.data, periodEnd: parsed.data.periodEndExclusive,
      operatorAuthorization: request.headers.get("authorization") });
    return NextResponse.json({ ok: true, ...result }, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (postgresCode(error) === "23505") {
      return NextResponse.json({ ok: false, code: "invoice_number_conflict" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      const statusCode = code === "not_authorized" ? 401 : code === "coverage_conflict" || code === "duplicate_request_conflict" || code === "manual_route_unavailable" ? 409 : 400;
      return NextResponse.json({ ok: false, code }, { status: statusCode, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[V2 admin billing] Order creation failed.");
    return NextResponse.json({ ok: false, code: "billing_order_create_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
