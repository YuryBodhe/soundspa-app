import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import {
  baseChannels, channelTracks, channels, deviceActivationTokens, deviceCurrentState, deviceEvents, devices,
  locationChannelEntitlements, locationChannelGrants, locationChannelVisibility, locationServiceAccess,
  locations, organizationMembers, organizations, users,
} from "../../db/v2/schema";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fingerprint = (value: unknown) => hash(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item));

async function counts() {
  const target = await v2Db.execute(sql`SELECT current_database() AS db, current_user AS usr`);
  assert.equal(target.rows[0]?.db, "soundspa_v2");
  assert.equal(target.rows[0]?.usr, "soundspa_v2");
  const results = await Promise.all([
    v2Db.select({ n: sql<number>`count(*)::int` }).from(organizations),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(locations),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(users),
    v2Db.select({ n: sql<number>`count(*)::int` }).from(organizationMembers),
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
  assert.equal(values[15], 8, "V2 migration journal must remain at eight.");
  // Live Players can append monitoring rows between snapshots; synthetic
  // Device state/event ownership is asserted directly by identity below.
  return values.filter((_value, index) => index !== 6 && index !== 7);
}

async function locationSnapshot(locationIds: string[]) {
  const deviceRows = locationIds.length ? await v2Db.select({ id: devices.id }).from(devices).where(inArray(devices.locationId, locationIds)) : [];
  const ids = deviceRows.map(({ id }) => id);
  return {
    locations: await v2Db.select().from(locations).where(inArray(locations.id, locationIds)).orderBy(locations.id),
    devices: await v2Db.select().from(devices).where(inArray(devices.locationId, locationIds)).orderBy(devices.id),
    activationTokens: ids.length ? await v2Db.select({ id: deviceActivationTokens.id, deviceId: deviceActivationTokens.deviceId, expiresAt: deviceActivationTokens.expiresAt, usedAt: deviceActivationTokens.usedAt }).from(deviceActivationTokens).where(inArray(deviceActivationTokens.deviceId, ids)).orderBy(deviceActivationTokens.id) : [],
    currentStates: ids.length ? await v2Db.select().from(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, ids)).orderBy(deviceCurrentState.deviceId) : [],
    events: ids.length ? await v2Db.select({ id: deviceEvents.id, deviceId: deviceEvents.deviceId, eventType: deviceEvents.eventType, channelId: deviceEvents.channelId, details: deviceEvents.details }).from(deviceEvents).where(inArray(deviceEvents.deviceId, ids)).orderBy(deviceEvents.id) : [],
    visibility: await v2Db.select().from(locationChannelVisibility).where(inArray(locationChannelVisibility.locationId, locationIds)).orderBy(locationChannelVisibility.locationId),
    grants: await v2Db.select().from(locationChannelGrants).where(inArray(locationChannelGrants.locationId, locationIds)).orderBy(locationChannelGrants.id),
    entitlements: await v2Db.select().from(locationChannelEntitlements).where(inArray(locationChannelEntitlements.locationId, locationIds)).orderBy(locationChannelEntitlements.locationId),
    serviceAccess: await v2Db.select().from(locationServiceAccess).where(inArray(locationServiceAccess.locationId, locationIds)),
  };
}

async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to authorize synthetic-only Organization deletion regressions.");
  const username = process.env.V2_ADMIN_USERNAME;
  const password = process.env.V2_ADMIN_PASSWORD;
  assert(username && password, "Temporary operator authorization must be configured in memory.");
  const origin = process.env.V2_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
  const publicOrigin = new URL(process.env.V2_PUBLIC_ORIGIN || origin).origin;
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const before = await counts();
  const marker = `Gate 3C ${randomUUID()}`;
  const organizationIds: string[] = [];
  const locationIds: string[] = [];
  const deviceIds: string[] = [];
  const syntheticUserIds: string[] = [];

  try {
    const [channel] = await v2Db.select({ id: channels.id }).from(channels).orderBy(channels.id).limit(1);
    assert(channel, "A global channel is required for scoped Access fixtures.");
    const [organizationA] = await v2Db.insert(organizations).values({ name: `${marker} A` }).returning({ id: organizations.id });
    organizationIds.push(organizationA.id);
    const [organizationB] = await v2Db.insert(organizations).values({ name: `${marker} B` }).returning({ id: organizations.id });
    organizationIds.push(organizationB.id);
    const [emptyOrganization] = await v2Db.insert(organizations).values({ name: `${marker} Empty` }).returning({ id: organizations.id });
    organizationIds.push(emptyOrganization.id);

    const [syntheticUser] = await v2Db.insert(users).values({ email: `${randomUUID()}@gate-3c.invalid`, displayName: `${marker} synthetic member` }).returning({ id: users.id });
    syntheticUserIds.push(syntheticUser.id);
    await v2Db.insert(organizationMembers).values({ organizationId: organizationA.id, userId: syntheticUser.id, role: "manager" });
    const [syntheticUserB] = await v2Db.insert(users).values({ email: `${randomUUID()}@gate-3c.invalid`, displayName: `${marker} synthetic B member` }).returning({ id: users.id });
    syntheticUserIds.push(syntheticUserB.id);
    await v2Db.insert(organizationMembers).values({ organizationId: organizationB.id, userId: syntheticUserB.id, role: "owner" });

    const createLocation = async (organizationId: string, suffix: string) => {
      const [location] = await v2Db.insert(locations).values({
        organizationId, name: `${marker} ${suffix}`, slug: `gate-3c-${randomUUID()}`, timezone: "Asia/Bangkok",
      }).returning({ id: locations.id, name: locations.name });
      locationIds.push(location.id);
      return location;
    };
    const locationA1 = await createLocation(organizationA.id, "A1");
    const locationA2 = await createLocation(organizationA.id, "A2");
    const locationB1 = await createLocation(organizationB.id, "B1");

    const createDevice = async (locationId: string, label: string, credentialHash: string | null = null) => {
      const [device] = await v2Db.insert(devices).values({ locationId, label, credentialHash }).returning({ id: devices.id });
      deviceIds.push(device.id);
      return device;
    };
    const pendingA1 = await createDevice(locationA1.id, `${marker} pending A1`);
    const activatedCredential = randomBytes(32).toString("base64url");
    const activatedA1 = await createDevice(locationA1.id, `${marker} activated A1`, hash(activatedCredential));
    const deviceA2 = await createDevice(locationA2.id, `${marker} A2`);
    const deviceB1 = await createDevice(locationB1.id, `${marker} B1`, hash(randomBytes(32).toString("base64url")));

    await v2Db.insert(deviceActivationTokens).values([
      { deviceId: pendingA1.id, tokenHash: hash(randomBytes(32).toString("base64url")), expiresAt: new Date(Date.now() + 86_400_000) },
      { deviceId: activatedA1.id, tokenHash: hash(randomBytes(32).toString("base64url")), expiresAt: new Date(Date.now() - 60_000), usedAt: new Date() },
      { deviceId: deviceB1.id, tokenHash: hash(randomBytes(32).toString("base64url")), expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    const allDevices = [pendingA1, activatedA1, deviceA2, deviceB1];
    for (const device of allDevices) {
      await v2Db.insert(deviceCurrentState).values({ deviceId: device.id, currentChannelId: channel.id });
      await v2Db.insert(deviceEvents).values({ deviceId: device.id, eventType: "session_started", channelId: channel.id });
    }

    for (const locationId of [locationA1.id, locationA2.id, locationB1.id]) {
      await v2Db.insert(locationChannelVisibility).values({ locationId, channelId: channel.id });
      await v2Db.insert(locationChannelGrants).values({ locationId, channelId: channel.id });
      await v2Db.insert(locationChannelEntitlements).values({ locationId, channelId: channel.id, accessType: "included" });
      await v2Db.insert(locationServiceAccess).values({ locationId, trialEndsAt: new Date(Date.now() + 86_400_000) });
    }

    const adminResponse = await fetch(`${origin}/admin/ui`, { headers: { Authorization: auth } });
    assert.equal(adminResponse.status, 200);
    const adminHtml = await adminResponse.text();
    const normalizedAdminHtml = adminHtml.replace(/<!--.*?-->/g, "");
    assert(normalizedAdminHtml.includes(`Delete Organization`));
    assert(normalizedAdminHtml.includes(`${marker} A`));
    assert(normalizedAdminHtml.includes("2 Location(s)"));
    assert(normalizedAdminHtml.includes("3 Player Device(s)"));
    assert(normalizedAdminHtml.includes(`Type “${marker} A” to enable deletion`));

    const url = `${origin}/api/v2/admin/organizations/${organizationA.id}`;
    const payload = JSON.stringify({ confirmationName: `${marker} A` });
    const beforeRejectedMutations = await counts();
    assert.equal((await fetch(url, { method: "DELETE", headers: { Origin: publicOrigin, "Content-Type": "application/json" }, body: payload })).status, 401, "unauthenticated Organization deletion must reject");
    assert.equal((await fetch(url, { method: "DELETE", headers: { Origin: publicOrigin, Cookie: "soundspa_v2_device=invalid", "Content-Type": "application/json" }, body: payload })).status, 401, "Device cookie must not authorize Organization deletion");
    assert.equal((await fetch(url, { method: "DELETE", headers: { Authorization: auth, Origin: "https://untrusted.invalid", "Content-Type": "application/json" }, body: payload })).status, 403, "cross-origin Organization deletion must reject");
    assert.equal((await fetch(url, { method: "DELETE", headers: { Authorization: auth, Origin: publicOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ confirmationName: "wrong" }) })).status, 409, "typed-name mismatch must not delete");
    assert.equal((await fetch(`${origin}/api/v2/admin/organizations/00000000-0000-4000-8000-000000000000`, { method: "DELETE", headers: { Authorization: auth, Origin: publicOrigin, "Content-Type": "application/json" }, body: payload })).status, 404);
    assert.equal((await counts()).join(","), beforeRejectedMutations.join(","), "rejected requests must be non-mutating");

    const globalBefore = fingerprint({
      channels: await v2Db.select({ id: channels.id, slug: channels.slug, kind: channels.kind, sortOrder: channels.sortOrder }).from(channels).orderBy(channels.id),
      tracks: await v2Db.select({ id: channelTracks.id, channelId: channelTracks.channelId, storageKey: channelTracks.storageKey, sizeBytes: channelTracks.sizeBytes, sortOrder: channelTracks.sortOrder, isEnabled: channelTracks.isEnabled }).from(channelTracks).orderBy(channelTracks.id),
      base: await v2Db.select().from(baseChannels).orderBy(baseChannels.channelId),
    });
    const bBefore = await locationSnapshot([locationB1.id]);
    const bFingerprintBefore = fingerprint(bBefore);
    const bMembershipBefore = await v2Db.select().from(organizationMembers).where(eq(organizationMembers.organizationId, organizationB.id)).orderBy(organizationMembers.userId);
    const aDataBefore = await locationSnapshot([locationA1.id, locationA2.id]);
    assert.equal(aDataBefore.devices.length, 3);

    const credentialCookie = `soundspa_v2_device=${activatedCredential}`;
    const beforeInvalidation = await fetch(`${origin}/api/v2/catalog`, { headers: { Cookie: credentialCookie } });
    assert.notEqual(beforeInvalidation.status, 401, "synthetic activated Device credential should authenticate before deletion");

    const deleteResponse = await fetch(url, { method: "DELETE", headers: { Authorization: auth, Origin: publicOrigin, "Content-Type": "application/json" }, body: payload });
    assert.equal(deleteResponse.status, 200);
    const deleteResult = await deleteResponse.json() as { ok: boolean; removed: Record<string, number> };
    assert.equal(deleteResult.ok, true);
    assert.deepEqual(deleteResult.removed, {
      locations: 2, devices: 3, activationTokens: 2, currentStates: 3, events: 3,
      visibility: 2, grants: 2, entitlements: 2, serviceAccess: 2, memberships: 1,
    });
    assert.equal((await v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationA.id))).length, 0);
    assert.equal((await locationSnapshot([locationA1.id, locationA2.id])).locations.length, 0);
    assert.equal((await v2Db.select({ id: deviceActivationTokens.id }).from(deviceActivationTokens).where(inArray(deviceActivationTokens.deviceId, [pendingA1.id, activatedA1.id, deviceA2.id]))).length, 0);
    assert.equal((await v2Db.select({ id: deviceCurrentState.deviceId }).from(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, [pendingA1.id, activatedA1.id, deviceA2.id]))).length, 0);
    assert.equal((await v2Db.select({ id: deviceEvents.id }).from(deviceEvents).where(inArray(deviceEvents.deviceId, [pendingA1.id, activatedA1.id, deviceA2.id]))).length, 0);
    assert.equal((await v2Db.select({ userId: organizationMembers.userId }).from(organizationMembers).where(eq(organizationMembers.organizationId, organizationA.id))).length, 0);
    assert.equal((await v2Db.select({ id: users.id }).from(users).where(eq(users.id, syntheticUser.id))).length, 1, "Organization deletion must not delete a potentially shared User");
    const afterInvalidation = await fetch(`${origin}/api/v2/catalog`, { headers: { Cookie: credentialCookie } });
    assert.equal(afterInvalidation.status, 401, "old Device cookie must be invalid after its Organization is deleted");

    const bAfter = await locationSnapshot([locationB1.id]);
    assert.equal(fingerprint(bAfter), bFingerprintBefore, "unrelated Organization B and its Location-owned rows must remain unchanged");
    assert.deepEqual(await v2Db.select().from(organizationMembers).where(eq(organizationMembers.organizationId, organizationB.id)).orderBy(organizationMembers.userId), bMembershipBefore, "unrelated Organization B membership must remain unchanged");
    const globalAfter = fingerprint({
      channels: await v2Db.select({ id: channels.id, slug: channels.slug, kind: channels.kind, sortOrder: channels.sortOrder }).from(channels).orderBy(channels.id),
      tracks: await v2Db.select({ id: channelTracks.id, channelId: channelTracks.channelId, storageKey: channelTracks.storageKey, sizeBytes: channelTracks.sizeBytes, sortOrder: channelTracks.sortOrder, isEnabled: channelTracks.isEnabled }).from(channelTracks).orderBy(channelTracks.id),
      base: await v2Db.select().from(baseChannels).orderBy(baseChannels.channelId),
    });
    assert.equal(globalAfter, globalBefore, "global Channels, Tracks and Base must remain byte-for-byte equivalent in the snapshot");

    const emptyDelete = await fetch(`${origin}/api/v2/admin/organizations/${emptyOrganization.id}`, { method: "DELETE", headers: { Authorization: auth, Origin: publicOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ confirmationName: `${marker} Empty` }) });
    assert.equal(emptyDelete.status, 200, "an Organization with zero Locations should delete safely");
    assert.equal((await v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, emptyOrganization.id))).length, 0);
    console.info("V2 Organization deletion PASS: typed operator-only deletion, exact multi-Location cleanup, Device credential invalidation, shared User preservation, unrelated Organization/global Content/Base preservation, empty Organization deletion, and scoped synthetic cleanup.");
  } finally {
    await v2Db.transaction(async (tx) => {
      if (deviceIds.length) {
        await tx.delete(deviceActivationTokens).where(inArray(deviceActivationTokens.deviceId, deviceIds));
        await tx.delete(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, deviceIds));
        await tx.delete(deviceEvents).where(inArray(deviceEvents.deviceId, deviceIds));
        await tx.delete(devices).where(inArray(devices.id, deviceIds));
      }
      if (locationIds.length) {
        await tx.delete(locationChannelVisibility).where(inArray(locationChannelVisibility.locationId, locationIds));
        await tx.delete(locationChannelGrants).where(inArray(locationChannelGrants.locationId, locationIds));
        await tx.delete(locationChannelEntitlements).where(inArray(locationChannelEntitlements.locationId, locationIds));
        await tx.delete(locationServiceAccess).where(inArray(locationServiceAccess.locationId, locationIds));
        await tx.delete(locations).where(inArray(locations.id, locationIds));
      }
      if (organizationIds.length) {
        await tx.delete(organizationMembers).where(inArray(organizationMembers.organizationId, organizationIds));
        await tx.delete(organizations).where(inArray(organizations.id, organizationIds));
      }
      if (syntheticUserIds.length) await tx.delete(users).where(inArray(users.id, syntheticUserIds));
    });
    assert.equal(deviceIds.length ? (await v2Db.select({ n: sql<number>`count(*)::int` }).from(devices).where(inArray(devices.id, deviceIds)))[0].n : 0, 0);
    assert.equal(deviceIds.length ? (await v2Db.select({ n: sql<number>`count(*)::int` }).from(deviceActivationTokens).where(inArray(deviceActivationTokens.deviceId, deviceIds)))[0].n : 0, 0);
    assert.equal(deviceIds.length ? (await v2Db.select({ n: sql<number>`count(*)::int` }).from(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, deviceIds)))[0].n : 0, 0);
    assert.equal(deviceIds.length ? (await v2Db.select({ n: sql<number>`count(*)::int` }).from(deviceEvents).where(inArray(deviceEvents.deviceId, deviceIds)))[0].n : 0, 0);
    assert.equal(locationIds.length ? (await v2Db.select({ n: sql<number>`count(*)::int` }).from(locations).where(inArray(locations.id, locationIds)))[0].n : 0, 0);
    assert.equal(organizationIds.length ? (await v2Db.select({ n: sql<number>`count(*)::int` }).from(organizations).where(inArray(organizations.id, organizationIds)))[0].n : 0, 0);
    assert.equal(syntheticUserIds.length ? (await v2Db.select({ n: sql<number>`count(*)::int` }).from(users).where(inArray(users.id, syntheticUserIds)))[0].n : 0, 0);
    assert.deepEqual(await counts(), before, "all synthetic Organization fixtures must be removed and the DB returned to the exact baseline");
    await v2Pool.end();
  }
}

main().catch((error) => {
  const safeError = error instanceof Error ? error.name : typeof error;
  const safeCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? ` code=${error.code}` : "";
  const safeFrame = error instanceof Error ? error.stack?.split("\n").slice(1, 3).join(" | ") ?? "" : "";
  console.error(`V2 Organization deletion verification failed (${safeError}${safeCode})${error instanceof Error && error.name === "AssertionError" ? `: ${error.message.slice(0, 280)}` : safeFrame ? ` at ${safeFrame}` : ""}`);
  process.exitCode = 1;
});
