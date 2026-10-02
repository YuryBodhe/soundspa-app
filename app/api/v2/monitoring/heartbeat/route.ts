import { cookies } from "next/headers";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { isSameOriginMutation } from "@/lib/v2/adminOperator";

const COOKIE = "soundspa_v2_device";
const laneSchema = z.object({
  sequence: z.number().int().positive().safe(),
  state: z.enum(["idle", "playing", "paused", "buffering", "error"]),
  channelId: z.string().uuid().nullable(),
}).strict();
const bodySchema = z.object({
  sessionId: z.string().uuid(),
  generation: z.number().int().positive().safe(),
  music: laneSchema,
  ambient: laneSchema,
}).strict();
const NO_STORE = { "Cache-Control": "no-store" };
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: "Same-origin request required." }, { status: 403, headers: NO_STORE });
  }
  const credential = (await cookies()).get(COOKIE)?.value;
  if (!credential) return Response.json({ error: "Device authentication required." }, { status: 401, headers: NO_STORE });

  const [{ v2Db }, { channels }, { authenticateDeviceCredential }, { acceptMonitoringSnapshot }] = await Promise.all([
    import("@/db/v2/client"),
    import("@/db/v2/schema"),
    import("@/db/v2/queries/devices"),
    import("@/db/v2/services/monitoringSessions"),
  ]);
  const device = await authenticateDeviceCredential(credential);
  if (!device) return Response.json({ error: "Device authentication failed." }, { status: 401, headers: NO_STORE });

  let body: z.infer<typeof bodySchema>;
  try { body = bodySchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid monitoring payload." }, { status: 400, headers: NO_STORE }); }

  const claims = [
    ...(body.music.channelId ? [{ channelId: body.music.channelId, kind: "music" as const }] : []),
    ...(body.ambient.channelId ? [{ channelId: body.ambient.channelId, kind: "ambient" as const }] : []),
  ];
  if (claims.length) {
    const found = await v2Db.select({ id: channels.id, kind: channels.kind })
      .from(channels).where(inArray(channels.id, claims.map((claim) => claim.channelId)));
    if (claims.some((claim) => !found.some((channel) => channel.id === claim.channelId && channel.kind === claim.kind))) {
      return Response.json({ error: "Invalid monitoring channel claim." }, { status: 400, headers: NO_STORE });
    }
  }

  const result = await acceptMonitoringSnapshot({
    deviceId: device.deviceId,
    generation: body.generation,
    sessionId: body.sessionId,
    music: body.music,
    ambient: body.ambient,
  });
  return Response.json(result, { headers: NO_STORE });
}
