import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { authResponseHeaders, CUSTOMER_SESSION_COOKIE } from "@/lib/v2/customerAuthCore";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  timezone: z.string().trim().min(1).max(100),
}).strict();

function customerToken(request: Request): string | null {
  const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(CUSTOMER_SESSION_COOKIE.length + 1)); } catch { return null; }
}

function failure(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: authResponseHeaders() });
}

function statusFor(code: string): number {
  if (code === "unauthenticated") return 401;
  if (code === "owner_required" || code === "unverified") return 403;
  if (code === "organization_unavailable") return 404;
  if (code === "validation") return 400;
  if (["duplicate_name", "location_limit", "slug_conflict"].includes(code)) return 409;
  return 503;
}

type CustomerSession = { user: { id: string; emailVerifiedAt: Date | null } };
type CreatedLocation = { id: string; name: string; slug: string; timezone: string };
type RouteDependencies = {
  sameOrigin: typeof isSameOriginMutation;
  getSession: (token: string) => Promise<CustomerSession | null>;
  createLocation: (input: { authenticatedUserId: string; organizationId: string; name: string; timezone: string }) => Promise<CreatedLocation>;
};

export function createPostHandler(overrides: Partial<RouteDependencies> = {}) {
  return async function POST(request: Request) {
    const sameOrigin = overrides.sameOrigin ?? isSameOriginMutation;
    if (!sameOrigin(request)) return failure("request_not_allowed", 403);
    const token = customerToken(request);
    if (!token) return failure("unauthenticated", 401);

    try {
      const getSession = overrides.getSession ?? (async (sessionToken: string) => {
        const { getCustomerSession } = await import("@/db/v2/services/customerAuth");
        return getCustomerSession(sessionToken);
      });
      const session = await getSession(token);
      if (!session) return failure("unauthenticated", 401);
      if (!session.user.emailVerifiedAt) return failure("unverified", 403);

      const raw = await request.text();
      if (raw.length > 4096) return failure("invalid", 400);
      let body: z.infer<typeof inputSchema>;
      try { body = inputSchema.parse(JSON.parse(raw)); }
      catch { return failure("invalid", 400); }

      const createLocation = overrides.createLocation ?? (async (input: Parameters<RouteDependencies["createLocation"]>[0]) => {
        const { createCustomerLocation } = await import("@/db/v2/services/customerLocations");
        return createCustomerLocation(input);
      });
      const location = await createLocation({
        authenticatedUserId: session.user.id,
        organizationId: body.organizationId,
        name: body.name,
        timezone: body.timezone,
      });
      return NextResponse.json({ location }, { status: 201, headers: authResponseHeaders() });
    } catch (error) {
      const operation = error as { name?: unknown; code?: unknown };
      if (operation?.name === "CustomerLocationError") {
        const code = String(operation.code ?? "unavailable");
        return failure(code, statusFor(code));
      }
      console.error("[V2 customer Location creation] Request failed.");
      return failure("unavailable", 503);
    }
  };
}

export const POST = createPostHandler();
