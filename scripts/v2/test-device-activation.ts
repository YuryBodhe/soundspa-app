import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { isSameOriginMutation } from "../../lib/v2/adminOperator";
import {
  baseChannels, channelTracks, channels, deviceActivationTokens, deviceCurrentState, deviceEvents, devices,
  locationChannelEntitlements, locationChannelGrants, locationChannelVisibility, locationServiceAccess,
  locations, organizationMembers, organizations, users,
} from "../../db/v2/schema";

const LOCATION_ID = "15452bf7-c196-41fc-a1a4-9a0ed9e1a044";
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const getCookieValue = (header: string, name: string) => header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);

async function baseline() {
  const [target, counts, deviceStates, base, grants, visibility, fixture] = await Promise.all([
    v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`),
    Promise.all([
      v2Db.select({ count: sql<number>`count(*)::int` }).from(organizations),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(locations),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(users),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(organizationMembers),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(devices),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(deviceActivationTokens),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(deviceCurrentState),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(deviceEvents),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(locationServiceAccess),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelEntitlements),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelGrants),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelVisibility),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(baseChannels),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(channels),
      v2Db.select({ count: sql<number>`count(*)::int` }).from(channelTracks),
      v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`),
    ]),
    v2Db.select({ deviceId: deviceCurrentState.deviceId, lastSeenAt: deviceCurrentState.lastSeenAt, playbackState: deviceCurrentState.musicPlaybackState, updatedAt: deviceCurrentState.updatedAt }).from(deviceCurrentState).orderBy(deviceCurrentState.deviceId),
    v2Db.select({ channelId: baseChannels.channelId }).from(baseChannels),
    v2Db.select({ locationId: locationChannelGrants.locationId, channelId: locationChannelGrants.channelId, source: locationChannelGrants.source, enabled: locationChannelGrants.enabled, startsAt: locationChannelGrants.startsAt, endsAt: locationChannelGrants.endsAt }).from(locationChannelGrants),
    v2Db.select({ locationId: locationChannelVisibility.locationId, channelId: locationChannelVisibility.channelId, hidden: locationChannelVisibility.hidden }).from(locationChannelVisibility),
    v2Db.select({ name: locations.name, organizationName: organizations.name, archivedAt: locations.archivedAt, organizationArchivedAt: organizations.archivedAt }).from(locations).innerJoin(organizations, eq(organizations.id, locations.organizationId)).where(eq(locations.id, LOCATION_ID)).limit(1),
  ]);
  assert.equal(target.rows[0]?.database, "soundspa_v2");
  assert.equal(target.rows[0]?.user, "soundspa_v2");
  assert.equal(fixture[0]?.name, "Yury Test Spa");
  assert.equal(fixture[0]?.archivedAt, null);
  assert.equal(fixture[0]?.organizationArchivedAt, null);
  const countValues = counts.map((rows: any) => Array.isArray(rows) ? rows[0]?.count : rows.rows[0]?.count);
  assert.equal(countValues[15], 9, "V2 migration journal must contain the Gate 4A migration");
  return {
    // A real customer Player can update these heartbeat rows while the
    // synthetic activation test runs. Compare stable identities only, not
    // volatile last-seen/playback fields or the global event count.
    counts: countValues.filter((_value, index) => index !== 6 && index !== 7),
    deviceStates: deviceStates.map(({ deviceId }) => deviceId),
    fixture: fixture[0],
    base: base.map(({ channelId }) => channelId).sort(),
    grants: grants.map((row) => ({ ...row })).sort((a, b) => `${a.locationId}:${a.channelId}:${a.source}`.localeCompare(`${b.locationId}:${b.channelId}:${b.source}`)),
    visibility: visibility.map((row) => ({ ...row })).sort((a, b) => `${a.locationId}:${a.channelId}`.localeCompare(`${b.locationId}:${b.channelId}`)),
  };
}

async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to authorize scoped synthetic Device activation verification.");
  const username = process.env.V2_ADMIN_USERNAME; const password = process.env.V2_ADMIN_PASSWORD;
  assert(username && password, "Operator authorization must be configured in memory for the test app.");
  const origin = process.env.V2_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
  const publicOrigin = new URL(process.env.V2_PUBLIC_ORIGIN || origin).origin;
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const proxiedRequest = (headers: Record<string, string> = {}) => new Request(`${origin}/activate-device/test`, {
    method: "POST",
    headers: { Host: new URL(publicOrigin).host, "X-Forwarded-Proto": new URL(publicOrigin).protocol.slice(0, -1), ...headers },
  });
  assert(isSameOriginMutation(proxiedRequest({ Origin: publicOrigin })), "public Origin must pass the reverse-proxy request shape");
  assert(isSameOriginMutation(proxiedRequest({ Referer: `${publicOrigin}/activate-device/confirmation` })), "same-origin Referer fallback must pass");
  assert(!isSameOriginMutation(proxiedRequest({ Origin: "https://untrusted.invalid", Referer: `${publicOrigin}/` })), "cross-origin Origin must not be overridden by Referer");
  assert(!isSameOriginMutation(proxiedRequest({ Referer: "https://untrusted.invalid/" })), "cross-origin Referer must be rejected");
  assert(isSameOriginMutation(proxiedRequest({ "Sec-Fetch-Site": "same-origin" })), "same-origin Fetch Metadata is the narrow no-Origin/no-Referer fallback");
  assert(!isSameOriginMutation(proxiedRequest()), "requests with no origin metadata must fail closed");
  assert(isSameOriginMutation(proxiedRequest({ Origin: "null", "Sec-Fetch-Site": "same-origin" })), "literal Origin:null must pass the existing same-origin Fetch Metadata fallback");
  assert(isSameOriginMutation(proxiedRequest({ Origin: "null", Referer: `${publicOrigin}/activate-device/confirmation` })), "literal Origin:null must use a valid Referer fallback when present");
  assert(!isSameOriginMutation(proxiedRequest({ Origin: "null", Referer: "https://untrusted.invalid/", "Sec-Fetch-Site": "same-origin" })), "foreign Referer must still reject literal Origin:null");
  assert(!isSameOriginMutation(proxiedRequest({ Origin: "null", "Sec-Fetch-Site": "cross-site" })), "literal Origin:null with cross-site metadata must reject");
  assert(!isSameOriginMutation(proxiedRequest({ Origin: "null" })), "literal Origin:null without Referer or Fetch Metadata must reject");
  assert(!isSameOriginMutation(proxiedRequest({ Origin: "definitely-invalid-origin", "Sec-Fetch-Site": "same-origin" })), "non-null malformed Origin must not fall back to Fetch Metadata");
  assert(!isSameOriginMutation(proxiedRequest({ Origin: "https://untrusted.invalid", "Sec-Fetch-Site": "same-origin" })), "foreign valid Origin must reject regardless of same-origin Fetch Metadata");
  const before = await baseline();
  const syntheticIds: string[] = [];
  const marker = `Gate 3B ${randomUUID()}`;
  const syntheticNames: string[] = [];
  try {
    const unauthorized = await fetch(`${origin}/api/v2/admin/devices`, { method: "POST", headers: { Origin: publicOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ locationId: LOCATION_ID, name: "Gate 3B test" }) });
    assert.equal(unauthorized.status, 401);
    const crossOrigin = await fetch(`${origin}/api/v2/admin/devices`, { method: "POST", headers: { Authorization: authorization, Origin: "https://untrusted.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ locationId: LOCATION_ID, name: "Gate 3B test" }) });
    assert.equal(crossOrigin.status, 403);
    const invalidInput = await fetch(`${origin}/api/v2/admin/devices`, { method: "POST", headers: { Authorization: authorization, Origin: publicOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ locationId: LOCATION_ID, name: "  " }) });
    assert.equal(invalidInput.status, 400);
    assert.deepEqual(await baseline(), before, "Rejected mutations must not change staging state.");

    const create = async (name: string) => {
      assert.equal((await v2Db.select({ id: devices.id }).from(devices).where(and(eq(devices.locationId, LOCATION_ID), eq(devices.label, name)))).length, 0, "Synthetic Device label must be unique before creation.");
      syntheticNames.push(name);
      const response = await fetch(`${origin}/api/v2/admin/devices`, { method: "POST", headers: { Authorization: authorization, Origin: publicOrigin, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ locationId: LOCATION_ID, name }) });
      assert.equal(response.status, 201);
      const result = await response.json() as { ok: boolean; device: { id: string; label: string | null; status: string }; activationUrl: string; expiresAt: string };
      assert(!JSON.stringify(result).includes("credentialHash")); assert(!JSON.stringify(result).includes("credential_hash"));
      assert.equal(result.ok, true); assert.equal(result.device.label, name); assert.equal(result.device.status, "active");
      syntheticIds.push(result.device.id);
      assert.equal(new URL(result.activationUrl).origin, new URL(process.env.V2_PUBLIC_ORIGIN || origin).origin);
      assert.match(new URL(result.activationUrl).pathname, /^\/activate-device\/[A-Za-z0-9_-]{43}$/);
      const plainToken = new URL(result.activationUrl).pathname.split("/").at(-1)!;
      assert.equal(Date.parse(result.expiresAt) - Date.now() > 23 * 60 * 60 * 1000, true);
      assert.equal(Date.parse(result.expiresAt) - Date.now() <= 24 * 60 * 60 * 1000 + 30_000, true);
      const [{ devices: deviceRows }] = await v2Db.select({ devices: sql<number>`count(*)::int` }).from(devices).where(eq(devices.id, result.device.id));
      assert.equal(deviceRows, 1);
      const [deviceRow] = await v2Db.select({ credentialHash: devices.credentialHash, locationId: devices.locationId, label: devices.label }).from(devices).where(eq(devices.id, result.device.id));
      assert.equal(deviceRow.locationId, LOCATION_ID); assert.equal(deviceRow.label, name); assert.equal(deviceRow.credentialHash, null);
      const [{ count: tokenCount }] = await v2Db.select({ count: sql<number>`count(*)::int` }).from(deviceActivationTokens).where(eq(deviceActivationTokens.deviceId, result.device.id));
      assert.equal(tokenCount, 1);
      const [storedToken] = await v2Db.select({ tokenHash: deviceActivationTokens.tokenHash, expiresAt: deviceActivationTokens.expiresAt, usedAt: deviceActivationTokens.usedAt }).from(deviceActivationTokens).where(eq(deviceActivationTokens.deviceId, result.device.id));
      assert.equal(storedToken.tokenHash, sha256(plainToken));
      assert.notEqual(storedToken.tokenHash, plainToken);
      assert.equal(storedToken.usedAt, null);
      return { id: result.device.id, token: plainToken, activationUrl: result.activationUrl };
    };

    const firstDeviceName = `${marker} activation concurrency fixture`;
    const first = await create(firstDeviceName);
    const activationPath = new URL(first.activationUrl).pathname;
    assert.equal((await fetch(`${origin}/api/v2/catalog`, { headers: { Cookie: `soundspa_v2_device=${first.token}` } })).status, 401, "one-time token must not be accepted as a permanent device credential");
    for (let attempt = 0; attempt < 2; attempt++) {
      const confirmation = await fetch(`${origin}${activationPath}`, { redirect: "manual" });
      assert.equal(confirmation.status, 200, "valid activation GET must only show confirmation");
      assert.equal(confirmation.headers.get("location"), null, "activation GET must not redirect");
      assert.equal(confirmation.headers.get("set-cookie"), null, "activation GET must not set the Device cookie");
      const confirmationHtml = await confirmation.text();
      assert(confirmationHtml.includes("Activate this device?"));
      assert(confirmationHtml.includes(before.fixture.organizationName));
      assert(confirmationHtml.includes(before.fixture.name));
      assert(confirmationHtml.includes(firstDeviceName));
      assert(!confirmationHtml.includes(first.token), "confirmation HTML must not echo the activation token");
      const [stillPending] = await v2Db.select({ credentialHash: devices.credentialHash }).from(devices).where(eq(devices.id, first.id));
      const [stillUnused] = await v2Db.select({ usedAt: deviceActivationTokens.usedAt }).from(deviceActivationTokens).where(eq(deviceActivationTokens.deviceId, first.id));
      assert.equal(stillPending.credentialHash, null, "confirmation GET must not issue a permanent credential");
      assert.equal(stillUnused.usedAt, null, "confirmation GET must not consume the activation token");
    }
    const crossOriginPost = await fetch(`${origin}${activationPath}`, { method: "POST", headers: { Origin: "https://untrusted.invalid" }, redirect: "manual" });
    assert.equal(crossOriginPost.status, 403, "activation POST must reject cross-origin requests");
    const crossOriginRefererPost = await fetch(`${origin}${activationPath}`, { method: "POST", headers: { Referer: "https://untrusted.invalid/activate" }, redirect: "manual" });
    assert.equal(crossOriginRefererPost.status, 403, "activation POST must reject cross-origin Referer fallback");
    const nullOriginActivation = await fetch(`${origin}${activationPath}`, {
      method: "POST",
      headers: { Origin: "null", "Sec-Fetch-Site": "same-origin" },
      redirect: "manual",
    });
    assert.equal(nullOriginActivation.status, 303, "Origin:null plus same-origin Fetch Metadata must reach synthetic token validation and activate once");
    assert.equal(new URL(nullOriginActivation.headers.get("location")!).pathname, "/player");
    const nullOriginCookie = nullOriginActivation.headers.get("set-cookie") ?? "";
    assert.match(nullOriginCookie, /soundspa_v2_device=[A-Za-z0-9_-]{43}/);
    assert.match(nullOriginCookie, /HttpOnly/i); assert.match(nullOriginCookie, /Secure/i); assert.match(nullOriginCookie, /SameSite=Lax/i);
    const concurrentDevice = await create(`${marker} concurrent activation fixture`);
    const concurrentPath = new URL(concurrentDevice.activationUrl).pathname;
    const concurrent = await Promise.all([
      fetch(`${origin}${concurrentPath}`, { method: "POST", headers: { Origin: publicOrigin }, redirect: "manual" }),
      fetch(`${origin}${concurrentPath}`, { method: "POST", headers: { Origin: publicOrigin }, redirect: "manual" }),
    ]);
    assert.equal(concurrent.filter((response) => response.status === 303).length, 1, "exactly one parallel activation may consume a token");
    assert.equal(concurrent.filter((response) => response.status === 410).length, 1, "the racing reuse must be rejected");
    const successful = concurrent.find((response) => response.status === 303)!;
    assert.equal(new URL(successful.headers.get("location")!).pathname, "/player");
    const setCookie = successful.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /soundspa_v2_device=[A-Za-z0-9_-]{43}/);
    assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /Secure/i); assert.match(setCookie, /SameSite=Lax/i); assert.match(setCookie, /Path=\//i); assert.match(setCookie, /Max-Age=31536000/i);
    const credential = getCookieValue(setCookie, "soundspa_v2_device"); assert(credential);
    const [activated] = await v2Db.select({ credentialHash: devices.credentialHash, locationId: devices.locationId }).from(devices).where(eq(devices.id, concurrentDevice.id));
    assert.equal(activated.locationId, LOCATION_ID); assert.equal(activated.credentialHash, sha256(credential));
    const [{ usedCount }] = await v2Db.select({ usedCount: sql<number>`count(*)::int` }).from(deviceActivationTokens).where(and(eq(deviceActivationTokens.deviceId, concurrentDevice.id), sql`${deviceActivationTokens.usedAt} IS NOT NULL`));
    assert.equal(usedCount, 1);
    assert.equal((await fetch(`${origin}${concurrentPath}`, { redirect: "manual" })).status, 410, "activation GET after success must show unavailable state");
    assert.equal((await fetch(`${origin}${concurrentPath}`, { method: "POST", headers: { Origin: publicOrigin }, redirect: "manual" })).status, 410, "a second explicit activation POST must be rejected");

    const activatedCredential = getCookieValue(nullOriginCookie, "soundspa_v2_device"); assert(activatedCredential);
    const customerCatalog = await fetch(`${origin}/api/v2/catalog`, { headers: { Cookie: `soundspa_v2_device=${activatedCredential}` } });
    assert.equal(customerCatalog.status, 200, "issued cookie must authenticate the Location-bound customer catalog");
    const catalogBody = await customerCatalog.json() as { organizationName: string; locationName: string; channels: unknown[] };
    assert.equal(catalogBody.organizationName, before.fixture.organizationName, "activated Player must receive Organization branding");
    assert.equal(catalogBody.locationName, before.fixture.name, "activated Player must receive Location branding");
    assert(Array.isArray(catalogBody.channels));
    const playerPage = await fetch(`${origin}/player`, { headers: { Cookie: `soundspa_v2_device=${activatedCredential}` } });
    assert.equal(playerPage.status, 200, "the activated cookie should reach the normal /player route");
    const listedAdmin = await fetch(`${origin}/admin/ui?location=${LOCATION_ID}`, { headers: { Authorization: authorization } });
    assert.equal(listedAdmin.status, 200);
    const adminHtml = await listedAdmin.text(); assert(adminHtml.includes(firstDeviceName)); assert(adminHtml.includes("ACTIVATED"));
    assert(!adminHtml.includes(first.token), "Admin refresh must not recover a consumed plaintext activation token");
    assert(!adminHtml.includes("credentialHash"), "Admin listing must not expose permanent credential hashes");

    const expiredFixture = await create(`${marker} expired-link fixture`);
    await v2Db.update(deviceActivationTokens).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(deviceActivationTokens.tokenHash, sha256(expiredFixture.token)));
    assert.equal((await fetch(`${origin}${new URL(expiredFixture.activationUrl).pathname}`, { redirect: "manual" })).status, 410);
    const [stillPending] = await v2Db.select({ credentialHash: devices.credentialHash }).from(devices).where(eq(devices.id, expiredFixture.id));
    assert.equal(stillPending.credentialHash, null, "expired link must not activate its Device");
    assert.equal((await fetch(`${origin}/activate-device/${"A".repeat(43)}`, { redirect: "manual" })).status, 410, "unknown token must fail with the controlled invalid-link response");

    const revokedFixture = await create(`${marker} revoked-link fixture`);
    await v2Db.update(devices).set({ status: "revoked", revokedAt: new Date() }).where(eq(devices.id, revokedFixture.id));
    assert.equal((await fetch(`${origin}${new URL(revokedFixture.activationUrl).pathname}`, { redirect: "manual" })).status, 410, "a revoked Device must not activate");

    assert.equal((await v2Db.select({ id: deviceCurrentState.deviceId }).from(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, syntheticIds))).length, 0, "activation must not create fake monitoring state");
    assert.equal((await v2Db.select({ id: deviceEvents.id }).from(deviceEvents).where(inArray(deviceEvents.deviceId, syntheticIds))).length, 0, "activation must not create monitoring events");
    console.info("V2 Device Activation PASS: proxied public-origin validation, same-origin Referer/Fetch Metadata fallback, cross-origin rejection, pending Device with hash-only expiring token, atomic single-use under concurrent requests, secure HttpOnly cookie, Location catalog auth, expiry/invalid/reuse rejection, Admin listing, and no automatic monitoring rows.");
  } finally {
    const foundSynthetic = syntheticNames.length ? await v2Db.select({ id: devices.id }).from(devices).where(and(eq(devices.locationId, LOCATION_ID), inArray(devices.label, syntheticNames))) : [];
    const cleanupIds = [...new Set([...syntheticIds, ...foundSynthetic.map(({ id }) => id)])];
    if (cleanupIds.length) {
      await v2Db.transaction(async (tx) => {
        await tx.delete(deviceActivationTokens).where(inArray(deviceActivationTokens.deviceId, cleanupIds));
        await tx.delete(devices).where(inArray(devices.id, cleanupIds));
      });
    }
    const after = await baseline();
    assert.deepEqual(after, before, "All scoped staging state must exactly return to its captured baseline.");
    await v2Pool.end();
  }
}

main().catch((error) => {
  console.error(`V2 Device Activation verification failed: ${error instanceof Error && error.name === "AssertionError" ? error.message.slice(0, 260) : "details suppressed"}`);
  process.exitCode = 1;
});
