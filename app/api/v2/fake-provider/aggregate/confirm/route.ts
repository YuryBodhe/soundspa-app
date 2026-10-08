import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders } from "@/lib/v2/customerAuthCore";
import { fakeProviderIsEnabled } from "@/lib/v2/fakePaymentProvider";

export const dynamic = "force-dynamic";
const headers = authResponseHeaders();
const bodySchema = z.object({ capability: z.string().min(1).max(2048) }).strict();

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "request_not_allowed" }, { status: 403, headers });
  if (!fakeProviderIsEnabled(process.env, request)) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return NextResponse.json({ error: "invalid" }, { status: 400, headers });
    const body = bodySchema.parse(JSON.parse(raw));
    const { confirmFakeBillingOrderAsPayer } = await import("@/db/v2/services/fakeBillingOrderProvider");
    return NextResponse.json(await confirmFakeBillingOrderAsPayer(body), { headers });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return NextResponse.json({ error: "invalid" }, { status: 400, headers });
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "unavailable";
    const status = code === "checkout_unavailable" ? 404 : code === "checkout_expired" ? 410 : 503;
    return NextResponse.json({ error: code }, { status, headers });
  }
}
