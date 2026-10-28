import { cookies } from "next/headers";
import { z } from "zod";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";

export const dynamic = "force-dynamic";
const releaseBody = z.object({ sessionId: z.string().uuid(), generation: z.number().int().positive().safe() }).strict();

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginMutation(request)) return Response.json({ error: "Same-origin request required." }, { status: 403, headers });
  const credential = (await cookies()).get("soundspa_v2_device")?.value;
  if (!credential) return Response.json({ error: "Device authentication required." }, { status: 401, headers });
  const parsed = releaseBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid monitoring release." }, { status: 400, headers });
  const [{ authenticateDeviceCredential }, { releaseMonitoringSession }] = await Promise.all([
    import("@/db/v2/queries/devices"), import("@/db/v2/services/monitoringSessions"),
  ]);
  const device = await authenticateDeviceCredential(credential);
  if (!device) return Response.json({ error: "Device authentication failed." }, { status: 401, headers });
  await releaseMonitoringSession({ deviceId: device.deviceId, ...parsed.data });
  return Response.json({ released: true }, { headers });
}
