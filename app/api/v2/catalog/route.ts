import { cookies } from "next/headers";
import { resolveImageUrl, resolveMediaUrl } from "@/app/v2/mediaUrls";

const COOKIE = "soundspa_v2_device";
export const dynamic = "force-dynamic";
export async function GET() {
  const credential = (await cookies()).get(COOKIE)?.value;
  if (!credential) return Response.json({ error: "Device authentication required." }, { status: 401 });
  const [{ authenticateDeviceCredential }, { resolveEffectiveChannelAccess }] = await Promise.all([import("@/db/v2/queries/devices"), import("@/db/v2/queries/effectiveAccess")]);
  const device = await authenticateDeviceCredential(credential);
  if (!device) return Response.json({ error: "Device authentication failed." }, { status: 401 });
  const content = await resolveEffectiveChannelAccess(device.locationId, new Date());
  const catalog = content.map((channel) => ({
    id: channel.id, slug: channel.slug, displayName: channel.displayName, kind: channel.kind,
    description: channel.description, imageUrl: resolveImageUrl(channel.imageKey), playable: channel.playable,
    suspended: channel.suspended, accessSources: channel.accessSources, accessExpiries: channel.accessExpiries,
    tracks: channel.playable ? channel.tracks.map((track) => ({ id: track.id, url: resolveMediaUrl(channel.kind, track.storageKey), sizeBytes: track.sizeBytes.toString(), originalFilename: channel.kind === "music" ? track.originalFilename : undefined })) : [],
  }));
  return Response.json({ channels: catalog }, { headers: { "Cache-Control": "no-store" } });
}
