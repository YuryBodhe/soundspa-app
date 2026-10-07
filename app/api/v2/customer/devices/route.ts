import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";
import { CustomerDeviceAuthorizationError } from "@/lib/v2/customerDeviceAuthorization";
import { authResponseHeaders, CUSTOMER_SESSION_COOKIE } from "@/lib/v2/customerAuthCore";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  locationId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(120),
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

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return failure("request_not_allowed", 403);

  const token = customerToken(request);
  if (!token) return failure("unauthenticated", 401);

  try {
    const { getCustomerSession } = await import("@/db/v2/services/customerAuth");
    const session = await getCustomerSession(token);
    if (!session) return failure("unauthenticated", 401);
    if (!session.user.emailVerifiedAt) return failure("unverified", 403);

    const raw = await request.text();
    if (raw.length > 4096) return failure("invalid", 400);
    let body: z.infer<typeof inputSchema>;
    try { body = inputSchema.parse(JSON.parse(raw)); }
    catch { return failure("invalid", 400); }

    const publicUrl = new URL(process.env.V2_PUBLIC_ORIGIN?.trim() || new URL(request.url).origin);
    if (publicUrl.username || publicUrl.password || (process.env.NODE_ENV === "production" && publicUrl.protocol !== "https:")) {
      return failure("unavailable", 503);
    }

    const { createCustomerDeviceWithActivation } = await import("@/db/v2/services/customerDevices");
    const created = await createCustomerDeviceWithActivation({
      authenticatedUserId: session.user.id,
      locationId: body.locationId,
      deviceName: body.deviceName,
    });
    const activationUrl = new URL(`/activate-device/${created.activationToken}`, publicUrl.origin).toString();
    return NextResponse.json({
      device: { label: created.device.label },
      activationUrl,
      expiresAt: created.expiresAt.toISOString(),
    }, { status: 201, headers: authResponseHeaders() });
  } catch (error) {
    const operation = error as { name?: unknown; code?: unknown };
    if (error instanceof CustomerDeviceAuthorizationError) {
      return failure(error.code, error.code === "unauthenticated" ? 401 : error.code === "unverified" ? 403 : 404);
    }
    if (operation?.name === "DeviceProvisioningError") {
      return failure(operation.code === "validation" ? "invalid" : "location_unavailable", operation.code === "validation" ? 400 : 404);
    }
    console.error("[V2 customer Device provisioning] Request failed.");
    return failure("unavailable", 503);
  }
}
