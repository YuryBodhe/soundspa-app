import { cookies } from "next/headers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { v2Db } from "@/db/v2/client";
import { channels, deviceCurrentState } from "@/db/v2/schema";
import { authenticateDeviceCredential } from "@/db/v2/queries/devices";

const COOKIE = "soundspa_v2_device";
const bodySchema = z.object({
  playbackState: z.enum(["idle", "playing", "paused", "buffering", "error"]),
  currentChannelId: z.string().uuid().nullable().optional(),
  clientVersion: z.string().trim().max(128).nullable().optional(),
  lastErrorCode: z.string().trim().max(128).nullable().optional(),
}).strict();

export async function POST(request: Request) {
  const credential = (await cookies()).get(COOKIE)?.value;
  if (!credential) return Response.json({ error: "Device authentication required." }, { status: 401 });
  const device = await authenticateDeviceCredential(credential);
  if (!device) return Response.json({ error: "Device authentication failed." }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try { body = bodySchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid monitoring payload." }, { status: 400 }); }
  if (body.currentChannelId) {
    const [channel] = await v2Db.select({ id: channels.id }).from(channels).where(eq(channels.id, body.currentChannelId));
    if (!channel) return Response.json({ error: "Unknown channel." }, { status: 400 });
  }
  const now = new Date();
  await v2Db.insert(deviceCurrentState).values({
    deviceId: device.deviceId, lastSeenAt: now, lastPlaybackAt: body.playbackState === "playing" ? now : null,
    playbackState: body.playbackState, currentChannelId: body.currentChannelId ?? null,
    clientVersion: body.clientVersion ?? null, lastErrorCode: body.lastErrorCode ?? null, updatedAt: now,
  }).onConflictDoUpdate({ target: deviceCurrentState.deviceId, set: {
    lastSeenAt: now, playbackState: body.playbackState, currentChannelId: body.currentChannelId ?? null,
    clientVersion: body.clientVersion ?? null, lastErrorCode: body.lastErrorCode ?? null, updatedAt: now,
    ...(body.playbackState === "playing" ? { lastPlaybackAt: now } : {}),
  }});
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
