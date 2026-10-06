import { operatorAuthResponse, operatorAuthStatus, isSameOriginMutation } from "../../../../../lib/v2/adminOperator";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  if (!isSameOriginMutation(request)) return new Response("Same-origin request required.", { status: 403 });
  const form = await request.formData(); const operation = String(form.get("operation") ?? ""); const channelId = String(form.get("channelId") ?? ""); const locationId = String(form.get("locationId") ?? "");
  const visibilityMutation = operation === "hide-channel" || operation === "show-channel";
  if (!new Set(["add-product-channel", "remove-product-channel", "enable-admin", "disable-admin", "hide-channel", "show-channel"]).has(operation)) return new Response("Unknown operation.", { status: 400 });
  if (!uuid.test(channelId) || ((operation.includes("admin") || visibilityMutation) && !uuid.test(locationId))) return new Response("Invalid target.", { status: 400 });
  try {
    const [{ addProductChannel, getSoundSpaProduct, removeProductChannel }, { disableLocationAdminGrant, upsertLocationAdminGrant }, { hideChannelForLocation, showChannelForLocation }, { channels, locations }, { and, eq, isNull }, { v2Db }] = await Promise.all([import("../../../../../db/v2/queries/commercialProducts"), import("../../../../../db/v2/queries/adminGrants"), import("../../../../../db/v2/queries/locationChannelVisibility"), import("../../../../../db/v2/schema"), import("drizzle-orm"), import("../../../../../db/v2/client")]);
    if (operation === "enable-admin") { const [location] = await v2Db.select({ id: locations.id }).from(locations).where(eq(locations.id, locationId)); const [channel] = await v2Db.select({ id: channels.id }).from(channels).where(eq(channels.id, channelId)); if (!location || !channel) return new Response("Target not found.", { status: 404 }); await upsertLocationAdminGrant({ locationId, channelId }); } else if (operation === "disable-admin") await disableLocationAdminGrant(locationId, channelId); else if (visibilityMutation) {
      const [location] = await v2Db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, locationId), isNull(locations.archivedAt)));
      const [channel] = await v2Db.select({ id: channels.id }).from(channels).where(and(eq(channels.id, channelId), eq(channels.isPublished, true), isNull(channels.archivedAt)));
      if (!location || !channel) return new Response("Active Location or published Channel not found.", { status: 404 });
      if (operation === "hide-channel") await hideChannelForLocation(locationId, channelId); else await showChannelForLocation(locationId, channelId);
    } else if (operation === "add-product-channel" || operation === "remove-product-channel") {
      if (String(form.get("productCode") ?? "") !== "soundspa") return new Response("Unknown product.", { status: 404 });
      const product = await getSoundSpaProduct(); if (!product) return new Response("SoundSpa product is not provisioned.", { status: 404 });
      const [channel] = await v2Db.select({ id: channels.id }).from(channels).where(and(eq(channels.id, channelId), eq(channels.isPublished, true), isNull(channels.archivedAt)));
      if (!channel) return new Response("Published Channel not found.", { status: 404 });
      if (operation === "add-product-channel") await addProductChannel(product.id, channelId); else await removeProductChannel(product.id, channelId);
    }
    if ((request.headers.get("accept") ?? "").includes("application/json")) return Response.json({ ok: true });
    return new Response(null, { status: 303, headers: { Location: `/admin${locationId ? `?location=${locationId}&` : "?"}message=Saved`, "Cache-Control": "no-store" } });
  } catch (error) { return new Response(error instanceof Error ? error.message : "Mutation failed.", { status: 400 }); }
}
