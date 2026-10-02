import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import {
  baseChannels, channelTracks, channels, deviceActivationTokens, deviceCurrentState, deviceEvents, devices,
  locationChannelEntitlements, locationChannelGrants, locationChannelVisibility, locationServiceAccess,
  locations, organizations,
} from "../../db/v2/schema";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const counts = async () => {
  const target = await v2Db.execute(sql`SELECT current_database() AS db, current_user AS usr`);
  assert.equal(target.rows[0]?.db, "soundspa_v2");
  assert.equal(target.rows[0]?.usr, "soundspa_v2");
  const results = await Promise.all([
    v2Db.select({ n: sql<number>`count(*)::int` }).from(organizations),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(locations),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(devices),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(deviceActivationTokens),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(deviceCurrentState),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(deviceEvents),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(locationChannelVisibility),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(locationChannelGrants),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(locationChannelEntitlements),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(locationServiceAccess),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(channels),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(channelTracks),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(baseChannels),
    v2Db.execute(sql`SELECT count(*)::int AS n FROM drizzle_v2.__drizzle_migrations`),
  ]);
  const values = results.map((result: any) => Array.isArray(result) ? result[0]?.n : result.rows[0]?.n);
  assert.equal(values[13], 8, "Migration journal must remain at eight.");
  return values;
};

async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to authorize synthetic-only staging regression tests.");
  const username = process.env.V2_ADMIN_USERNAME;
  const password = process.env.V2_ADMIN_PASSWORD;
  assert(username && password, "Temporary operator credentials must be provided in memory.");
  const origin = process.env.V2_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
  const publicOrigin = new URL(process.env.V2_PUBLIC_ORIGIN || origin).origin;
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const authHeaders = (extra: Record<string, string> = {}) => ({ Authorization: authorization, Origin: publicOrigin, ...extra });
  const before = await counts();
  const marker = `Gate 3B.3 ${randomUUID()}`;
  const syntheticDeviceIds: string[] = [];
  let organizationId: string | undefined;
  let locationA: { id: string; name: string } | undefined;
  let locationB: { id: string; name: string } | undefined;

  try {
    const [channel] = await v2Db.select({ id: channels.id }).from(channels).orderBy(channels.id).limit(1);
    assert(channel, "A real global channel is required for synthetic Location-owned fixtures.");
    const [organization] = await v2Db.insert(organizations).values({ name: `${marker} Organization` }).returning({ id: organizations.id });
    organizationId = organization.id;
    const [createdA] = await v2Db.insert(locations).values({ organizationId, name: `${marker} Alpha`, slug: `g-3b3-a-${randomUUID().slice(0, 8)}`, timezone: "Asia/Bangkok" }).returning({ id: locations.id, name: locations.name });
    const [createdB] = await v2Db.insert(locations).values({ organizationId, name: `${marker} Beta`, slug: `g-3b3-b-${randomUUID().slice(0, 8)}`, timezone: "Asia/Bangkok" }).returning({ id: locations.id, name: locations.name });
    locationA = createdA; locationB = createdB;

    await v2Db.insert(locationChannelVisibility).values({ locationId: locationA.id, channelId: channel.id });
    await v2Db.insert(locationChannelGrants).values({ locationId: locationA.id, channelId: channel.id });
    await v2Db.insert(locationChannelEntitlements).values({ locationId: locationA.id, channelId: channel.id, accessType: "included" });
    await v2Db.insert(locationServiceAccess).values({ locationId: locationA.id, trialEndsAt: new Date(Date.now() + 86_400_000) });

    const createPending = async (locationId: string, label: string) => {
      const token = randomBytes(32).toString("base64url");
      const [device] = await v2Db.insert(devices).values({ locationId, label, credentialHash: null }).returning({ id: devices.id, locationId: devices.locationId, label: devices.label });
      syntheticDeviceIds.push(device.id);
      await v2Db.insert(deviceActivationTokens).values({ deviceId: device.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
      return { ...device, token };
    };

    const recoverable = await createPending(locationA.id, `${marker} Reissue Device`);
    const adminPage = await fetch(`${origin}/admin/ui?location=${encodeURIComponent(locationA.id)}`, { headers: { Authorization: authorization } });
    assert.equal(adminPage.status, 200);
    const adminHtml = await adminPage.text();
    assert(adminHtml.includes("Reissue activation link"));
    assert(adminHtml.includes("Delete Device"));
    assert(adminHtml.includes("Delete Location"));

    const oldTokenPath = `/activate-device/${recoverable.token}`;
    const unauthReissue = await fetch(`${origin}/api/v2/admin/devices/${recoverable.id}/activation`, { method: "POST", headers: { Origin: publicOrigin } });
    assert.equal(unauthReissue.status, 401);
    const deviceCookieReissue = await fetch(`${origin}/api/v2/admin/devices/${recoverable.id}/activation`, { method: "POST", headers: { Origin: publicOrigin, Cookie: "soundspa_v2_device=invalid" } });
    assert.equal(deviceCookieReissue.status, 401, "customer Device cookie must not authorize reissue");
    const crossOriginReissue = await fetch(`${origin}/api/v2/admin/devices/${recoverable.id}/activation`, { method: "POST", headers: { ...authHeaders({ Origin: "https://untrusted.invalid" }) } });
    assert.equal(crossOriginReissue.status, 403);
    const reissuedResponse = await fetch(`${origin}/api/v2/admin/devices/${recoverable.id}/activation`, { method: "POST", headers: authHeaders() });
    assert.equal(reissuedResponse.status, 200);
    assert.equal(reissuedResponse.headers.get("cache-control"), "no-store");
    assert.equal(reissuedResponse.headers.get("referrer-policy"), "no-referrer");
    const reissued = await reissuedResponse.json() as { ok: boolean; activationUrl: string; expiresAt: string };
    assert.equal(reissued.ok, true);
    assert.equal(new URL(reissued.activationUrl).origin, publicOrigin);
    const newToken = new URL(reissued.activationUrl).pathname.split("/").at(-1)!;
    const newTokenHash = sha256(newToken);
    const [unchangedDevice] = await v2Db.select({ id: devices.id, locationId: devices.locationId, label: devices.label, credentialHash: devices.credentialHash, revokedAt: devices.revokedAt }).from(devices).where(eq(devices.id, recoverable.id));
    assert.deepEqual(unchangedDevice, { id: recoverable.id, locationId: locationA.id, label: recoverable.label, credentialHash: null, revokedAt: null });
    const tokenRows = await v2Db.select({ tokenHash: deviceActivationTokens.tokenHash, expiresAt: deviceActivationTokens.expiresAt, usedAt: deviceActivationTokens.usedAt }).from(deviceActivationTokens).where(eq(deviceActivationTokens.deviceId, recoverable.id));
    assert.equal(tokenRows.length, 1);
    assert.equal(tokenRows[0].tokenHash, newTokenHash);
    assert.notEqual(tokenRows[0].tokenHash, newToken);
    assert.equal(tokenRows[0].usedAt, null);
    assert.equal(Date.parse(reissued.expiresAt) - Date.now() > 23 * 60 * 60 * 1000, true);
    assert.equal(Date.parse(reissued.expiresAt) - Date.now() <= 24 * 60 * 60 * 1000 + 30_000, true);
    assert.equal((await fetch(`${origin}${oldTokenPath}`, { redirect: "manual" })).status, 410);
    assert.equal((await fetch(`${origin}/activate-device/${newToken}`, { redirect: "manual" })).status, 200);
    const [stillPending] = await v2Db.select({ credentialHash: devices.credentialHash }).from(devices).where(eq(devices.id, recoverable.id));
    const [stillUnused] = await v2Db.select({ usedAt: deviceActivationTokens.usedAt }).from(deviceActivationTokens).where(eq(deviceActivationTokens.tokenHash, newTokenHash));
    assert.equal(stillPending.credentialHash, null);
    assert.equal(stillUnused.usedAt, null);
    const activated = await fetch(`${origin}/activate-device/${newToken}`, { method: "POST", headers: { Origin: publicOrigin }, redirect: "manual" });
    assert.equal(activated.status, 303);
    assert.equal(new URL(activated.headers.get("location")!).pathname, "/player");
    const cookie = activated.headers.get("set-cookie") ?? "";
    assert.match(cookie, /soundspa_v2_device=[A-Za-z0-9_-]{43}/);
    assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Lax/i);
    assert.equal((await fetch(`${origin}/api/v2/admin/devices/${recoverable.id}/activation`, { method: "POST", headers: authHeaders() })).status, 409, "an activated Device must not receive a reissued link");

    const deviceToDelete = await createPending(locationA.id, `${marker} Delete Device`);
    const [{ id: channelId }] = await v2Db.select({ id: channels.id }).from(channels).orderBy(channels.id).limit(1);
    await v2Db.insert(deviceCurrentState).values({ deviceId: deviceToDelete.id, currentChannelId: channelId });
    await v2Db.insert(deviceEvents).values({ deviceId: deviceToDelete.id, eventType: "session_started", channelId });
    const locationAccessBefore = {
      visibility: await v2Db.select().from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, locationA.id)),
      grants: await v2Db.select().from(locationChannelGrants).where(eq(locationChannelGrants.locationId, locationA.id)),
      entitlements: await v2Db.select().from(locationChannelEntitlements).where(eq(locationChannelEntitlements.locationId, locationA.id)),
      serviceAccess: await v2Db.select().from(locationServiceAccess).where(eq(locationServiceAccess.locationId, locationA.id)),
    };
    const noAuthDelete = await fetch(`${origin}/api/v2/admin/devices/${deviceToDelete.id}`, { method: "DELETE", headers: { Origin: publicOrigin, Cookie: "soundspa_v2_device=invalid" } });
    assert.equal(noAuthDelete.status, 401);
    const crossOriginDelete = await fetch(`${origin}/api/v2/admin/devices/${deviceToDelete.id}`, { method: "DELETE", headers: authHeaders({ Origin: "https://untrusted.invalid" }) });
    assert.equal(crossOriginDelete.status, 403);
    const notFoundDelete = await fetch(`${origin}/api/v2/admin/devices/00000000-0000-4000-8000-000000000000`, { method: "DELETE", headers: authHeaders() });
    assert.equal(notFoundDelete.status, 404);
    const deletedDeviceResponse = await fetch(`${origin}/api/v2/admin/devices/${deviceToDelete.id}`, { method: "DELETE", headers: authHeaders() });
    assert.equal(deletedDeviceResponse.status, 200);
    assert.equal((await deletedDeviceResponse.json() as { ok: boolean }).ok, true);
    assert.equal((await v2Db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceToDelete.id))).length, 0);
    assert.equal((await v2Db.select({ id: deviceActivationTokens.id }).from(deviceActivationTokens).where(eq(deviceActivationTokens.deviceId, deviceToDelete.id))).length, 0);
    assert.equal((await v2Db.select({ deviceId: deviceCurrentState.deviceId }).from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, deviceToDelete.id))).length, 0);
    assert.equal((await v2Db.select({ id: deviceEvents.id }).from(deviceEvents).where(eq(deviceEvents.deviceId, deviceToDelete.id))).length, 0);
    assert.equal((await v2Db.select({ id: devices.id }).from(devices).where(eq(devices.id, recoverable.id))).length, 1);
    assert.deepEqual({
      visibility: await v2Db.select().from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, locationA.id)),
      grants: await v2Db.select().from(locationChannelGrants).where(eq(locationChannelGrants.locationId, locationA.id)),
      entitlements: await v2Db.select().from(locationChannelEntitlements).where(eq(locationChannelEntitlements.locationId, locationA.id)),
      serviceAccess: await v2Db.select().from(locationServiceAccess).where(eq(locationServiceAccess.locationId, locationA.id)),
    }, locationAccessBefore, "deleting one Device must not alter Location access configuration");

    const betaDevice = await createPending(locationB.id, `${marker} Beta Device`);
    await v2Db.insert(deviceCurrentState).values({ deviceId: recoverable.id, currentChannelId: channelId });
    await v2Db.insert(deviceEvents).values({ deviceId: recoverable.id, eventType: "session_started", channelId });
    await v2Db.insert(deviceCurrentState).values({ deviceId: betaDevice.id, currentChannelId: channelId });
    await v2Db.insert(deviceEvents).values({ deviceId: betaDevice.id, eventType: "session_started", channelId });
    const baselineBeforeLocationDelete = await counts();
    const noAuthLocationDelete = await fetch(`${origin}/api/v2/admin/locations/${locationA.id}`, { method: "DELETE", headers: { Origin: publicOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ confirmationName: locationA.name }) });
    assert.equal(noAuthLocationDelete.status, 401);
    const deviceCookieLocationDelete = await fetch(`${origin}/api/v2/admin/locations/${locationA.id}`, { method: "DELETE", headers: { Origin: publicOrigin, Cookie: "soundspa_v2_device=invalid", "Content-Type": "application/json" }, body: JSON.stringify({ confirmationName: locationA.name }) });
    assert.equal(deviceCookieLocationDelete.status, 401, "customer Device cookie must not authorize Location deletion");
    const crossOriginLocationDelete = await fetch(`${origin}/api/v2/admin/locations/${locationA.id}`, { method: "DELETE", headers: authHeaders({ Origin: "https://untrusted.invalid", "Content-Type": "application/json" }), body: JSON.stringify({ confirmationName: locationA.name }) });
    assert.equal(crossOriginLocationDelete.status, 403);
    const wrongName = await fetch(`${origin}/api/v2/admin/locations/${locationA.id}`, { method: "DELETE", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ confirmationName: "not the location" }) });
    assert.equal(wrongName.status, 409);
    assert.deepEqual(await counts(), baselineBeforeLocationDelete, "failed Location deletion attempts must be non-mutating");

    const baseBefore = (await v2Db.select({ channelId: baseChannels.channelId }).from(baseChannels)).map(({ channelId }) => channelId).sort();
    const [channelCountBefore] = await v2Db.select({ n: sql<number>`count(*)::int` }).from(channels);
    const [trackCountBefore] = await v2Db.select({ n: sql<number>`count(*)::int` }).from(channelTracks);
    const deleteLocationResponse = await fetch(`${origin}/api/v2/admin/locations/${locationA.id}`, { method: "DELETE", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ confirmationName: locationA.name }) });
    assert.equal(deleteLocationResponse.status, 200);
    const deleteResult = await deleteLocationResponse.json() as { ok: boolean; location: { id: string }; removed: { devices: number; activationTokens: number; currentStates: number; events: number; visibility: number; grants: number; entitlements: number; serviceAccess: number } };
    assert.equal(deleteResult.ok, true);
    assert.equal(deleteResult.location.id, locationA.id);
    assert.equal(deleteResult.removed.devices, 1, "only the still-existing Device owned by Location A should be deleted");
    assert.equal(deleteResult.removed.activationTokens, 1);
    assert.equal(deleteResult.removed.currentStates, 1);
    assert.equal(deleteResult.removed.events, 1);
    assert.equal(deleteResult.removed.visibility, 1);
    assert.equal(deleteResult.removed.grants, 1);
    assert.equal(deleteResult.removed.entitlements, 1);
    assert.equal(deleteResult.removed.serviceAccess, 1);
    assert.equal((await v2Db.select({ id: locations.id }).from(locations).where(eq(locations.id, locationA.id))).length, 0);
    assert.equal((await v2Db.select({ id: devices.id }).from(devices).where(eq(devices.id, recoverable.id))).length, 0);
    assert.equal((await v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId!))).length, 1, "Organization must remain after its last Location is deleted");
    assert.equal((await v2Db.select({ id: locations.id }).from(locations).where(eq(locations.id, locationB.id))).length, 1, "sibling Location must remain untouched");
    assert.equal((await v2Db.select({ id: devices.id }).from(devices).where(eq(devices.id, betaDevice.id))).length, 1, "sibling Location Device must remain untouched");
    assert.equal((await v2Db.select({ id: deviceCurrentState.deviceId }).from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, betaDevice.id))).length, 1);
    assert.equal((await v2Db.select({ id: deviceEvents.id }).from(deviceEvents).where(eq(deviceEvents.deviceId, betaDevice.id))).length, 1);
    assert.deepEqual((await v2Db.select({ channelId: baseChannels.channelId }).from(baseChannels)).map(({ channelId }) => channelId).sort(), baseBefore);
    assert.equal((await v2Db.select({ n: sql<number>`count(*)::int` }).from(channels))[0].n, channelCountBefore.n);
    assert.equal((await v2Db.select({ n: sql<number>`count(*)::int` }).from(channelTracks))[0].n, trackCountBefore.n);

    console.info("V2 Device recovery/deletion PASS: pending-only activation reissue, old-token invalidation, hash-only persistence, single-use activation, Device-owned cleanup, Location-owned cleanup, sibling/Organization/global-content preservation, auth/same-origin and typed-name confirmation.");
  } finally {
    const deviceIds = [...new Set(syntheticDeviceIds)];
    await v2Db.transaction(async (tx) => {
      if (deviceIds.length) {
        await tx.delete(deviceActivationTokens).where(inArray(deviceActivationTokens.deviceId, deviceIds));
        await tx.delete(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, deviceIds));
        await tx.delete(deviceEvents).where(inArray(deviceEvents.deviceId, deviceIds));
        await tx.delete(devices).where(inArray(devices.id, deviceIds));
      }
      const locationIds = [locationA?.id, locationB?.id].filter((id): id is string => !!id);
      if (locationIds.length) {
        await tx.delete(locationChannelVisibility).where(inArray(locationChannelVisibility.locationId, locationIds));
        await tx.delete(locationChannelGrants).where(inArray(locationChannelGrants.locationId, locationIds));
        await tx.delete(locationChannelEntitlements).where(inArray(locationChannelEntitlements.locationId, locationIds));
        await tx.delete(locationServiceAccess).where(inArray(locationServiceAccess.locationId, locationIds));
        await tx.delete(locations).where(inArray(locations.id, locationIds));
      }
      if (organizationId) await tx.delete(organizations).where(eq(organizations.id, organizationId));
    });
    assert.deepEqual(await counts(), before, "All synthetic records must be removed and staging counts restored exactly.");
    await v2Pool.end();
  }
}

main().catch((error) => {
  console.error(`V2 Device recovery/deletion regression failed: ${error instanceof Error && error.name === "AssertionError" ? error.message.slice(0, 260) : "details suppressed"}`);
  process.exitCode = 1;
});
