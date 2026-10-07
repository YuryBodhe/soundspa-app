import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders, CUSTOMER_SESSION_COOKIE } from "@/lib/v2/customerAuthCore";

export const dynamic = "force-dynamic";

function customerToken(request: Request): string | null {
  const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(CUSTOMER_SESSION_COOKIE.length + 1)); } catch { return null; }
}

async function authenticatedSession(request: Request) {
  const token = customerToken(request);
  if (!token) return null;
  const { getCustomerSession } = await import("@/db/v2/services/customerAuth");
  return getCustomerSession(token);
}

export async function GET(request: Request) {
  try {
    const session = await authenticatedSession(request);
    if (!session || !session.user.emailVerifiedAt) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: authResponseHeaders() });
    const [{ getCustomerOnboarding, isPartnerSignupContext, hasCompletedPartnerOnboarding }, { listCustomerLocationsWithDevices }] = await Promise.all([
      import("@/db/v2/services/customerOnboarding"),
      import("@/db/v2/services/customerDevices"),
    ]);
    const account = await getCustomerOnboarding(session.user.id);
    const partnerContext = await isPartnerSignupContext(session.user.email);
    const partnerCompleted = await hasCompletedPartnerOnboarding(session.user.id, session.user.email);
    const locations = await listCustomerLocationsWithDevices(session.user.id);
    return NextResponse.json({ account, partnerContext, partnerCompleted, locations }, { headers: authResponseHeaders() });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: authResponseHeaders() });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "request_not_allowed" }, { status: 403, headers: authResponseHeaders() });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return NextResponse.json({ error: "invalid" }, { status: 400, headers: authResponseHeaders() });
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid" }, { status: 400, headers: authResponseHeaders() });
    const values = body as Record<string, unknown>;
    const session = await authenticatedSession(request);
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: authResponseHeaders() });
    if (!session.user.emailVerifiedAt) return NextResponse.json({ error: "unverified" }, { status: 403, headers: authResponseHeaders() });
    const { completeOrdinaryCustomerOnboarding, completePartnerCustomerOnboarding, isPartnerSignupContext } = await import("@/db/v2/services/customerOnboarding");
    const onboardingInput = {
      authenticatedUserId: session.user.id,
      signupIntentId: session.session.signupIntentId,
      organizationName: values.organizationName,
      locationName: values.locationName,
      timezone: values.timezone,
    };
    const partnerRequest = await isPartnerSignupContext(session.user.email);
    const result = await (partnerRequest
      ? completePartnerCustomerOnboarding(onboardingInput)
      : completeOrdinaryCustomerOnboarding(onboardingInput));
    const [{ getCustomerOnboarding, hasCompletedPartnerOnboarding }, { listCustomerLocationsWithDevices }] = await Promise.all([
      import("@/db/v2/services/customerOnboarding"),
      import("@/db/v2/services/customerDevices"),
    ]);
    const account = await getCustomerOnboarding(session.user.id);
    const partnerCompleted = partnerRequest || await hasCompletedPartnerOnboarding(session.user.id, session.user.email);
    const locations = await listCustomerLocationsWithDevices(session.user.id);
    return NextResponse.json({ ...result, account: account ?? result.account, partnerCompleted, locations }, { status: result.status === "completed" ? 201 : 200, headers: authResponseHeaders() });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "invalid" }, { status: 400, headers: authResponseHeaders() });
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code: string }).code;
      if (code === "partner_context") return NextResponse.json({ error: "partner_context" }, { status: 409, headers: authResponseHeaders() });
      if (code === "unverified") return NextResponse.json({ error: "unverified" }, { status: 403, headers: authResponseHeaders() });
      if (code === "unauthenticated") return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: authResponseHeaders() });
      if (code === "validation") return NextResponse.json({ error: "invalid_details" }, { status: 400, headers: authResponseHeaders() });
      if (code === "invite_unavailable") return NextResponse.json({ error: "partner_invite_unavailable" }, { status: 409, headers: authResponseHeaders() });
      if (code === "invitation_ambiguous") return NextResponse.json({ error: "partner_invite_ambiguous" }, { status: 409, headers: authResponseHeaders() });
      if (code === "existing_organization") return NextResponse.json({ error: "existing_organization" }, { status: 409, headers: authResponseHeaders() });
      if (code === "claim_failure") return NextResponse.json({ error: "partner_claim_failure" }, { status: 503, headers: authResponseHeaders() });
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: authResponseHeaders() });
  }
}
