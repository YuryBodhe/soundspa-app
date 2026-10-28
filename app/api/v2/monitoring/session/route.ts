import { cookies } from "next/headers";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";

const COOKIE = "soundspa_v2_device";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: "Same-origin request required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const credential = (await cookies()).get(COOKIE)?.value;
  if (!credential) return Response.json({ error: "Device authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const [{ authenticateDeviceCredential }, { beginMonitoringSession }] = await Promise.all([
    import("@/db/v2/queries/devices"),
    import("@/db/v2/services/monitoringSessions"),
  ]);
  const device = await authenticateDeviceCredential(credential);
  if (!device) return Response.json({ error: "Device authentication failed." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const session = await beginMonitoringSession(device.deviceId);
  if (session.status === "owner_active") {
    return Response.json({ status: "owner_active", retryAfterMs: session.retryAfterMs }, {
      status: 409, headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json({ sessionId: session.sessionId, generation: session.generation }, { headers: { "Cache-Control": "no-store" } });
}
