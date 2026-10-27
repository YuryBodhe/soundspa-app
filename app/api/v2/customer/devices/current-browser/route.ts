import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { CustomerDeviceAuthorizationError } from "@/lib/v2/customerDeviceAuthorization";
import { authResponseHeaders, CUSTOMER_SESSION_COOKIE } from "@/lib/v2/customerAuthCore";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  operationId: z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  locationId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(120),
}).strict();

type Session = { user: { id: string; emailVerifiedAt: Date | string | null } };
type Dependencies = {
  sameOrigin: (request: Request) => boolean;
  getSession: (token: string) => Promise<Session | null>;
  createDevice: (input: { authenticatedUserId: string; operationId: string; locationId: string; name: string }) => Promise<{ device: { label: string | null }; credential: string }>;
};

function customerToken(request: Request): string | null {
  const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(CUSTOMER_SESSION_COOKIE.length + 1)); } catch { return null; }
}

function failure(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: authResponseHeaders() });
}

export function createPostHandler(dependencies: Dependencies) {
  return async function POST(request: Request) {
    if (!dependencies.sameOrigin(request)) return failure("request_not_allowed", 403);
    const token = customerToken(request);
    if (!token) return failure("unauthenticated", 401);
    let session: Session | null;
    try { session = await dependencies.getSession(token); }
    catch { return failure("unavailable", 503); }
    if (!session) return failure("unauthenticated", 401);
    if (!session.user.emailVerifiedAt) return failure("unverified", 403);

    let body: z.infer<typeof inputSchema>;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return failure("invalid", 400);
      body = inputSchema.parse(JSON.parse(raw));
    } catch { return failure("invalid", 400); }

    try {
      const result = await dependencies.createDevice({
        authenticatedUserId: session.user.id,
        operationId: body.operationId,
        locationId: body.locationId,
        name: body.deviceName,
      });
      const response = NextResponse.json({ device: { label: result.device.label } }, { status: 201, headers: authResponseHeaders() });
      response.cookies.set("soundspa_v2_device", result.credential, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    } catch (error) {
      if (error instanceof CustomerDeviceAuthorizationError) {
        return failure(error.code, error.code === "unauthenticated" ? 401 : error.code === "unverified" ? 403 : 404);
      }
      const operation = error as { name?: unknown; code?: unknown };
      if (operation?.name === "DeviceProvisioningError") {
        if (operation.code === "operation_expired") return failure("operation_expired", 410);
        if (operation.code === "operation_conflict") return failure("operation_unavailable", 409);
        if (operation.code === "configuration_unavailable") return failure("unavailable", 503);
        return failure(operation.code === "validation" ? "invalid" : "location_unavailable", operation.code === "validation" ? 400 : 404);
      }
      console.error("[V2 customer current-device activation] Request failed.");
      return failure("unavailable", 503);
    }
  };
}

export async function POST(request: Request) {
  const handler = createPostHandler({
    sameOrigin: isSameOriginMutation,
    getSession: async (token) => {
      const { getCustomerSession } = await import("@/db/v2/services/customerAuth");
      return getCustomerSession(token);
    },
    createDevice: async (input) => {
      const { createAndActivateCustomerDevice } = await import("@/db/v2/services/deviceProvisioning");
      return createAndActivateCustomerDevice(input);
    },
  });
  return handler(request);
}
