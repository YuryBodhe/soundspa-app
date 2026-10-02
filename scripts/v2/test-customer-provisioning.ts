import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import {
  baseChannels,
  channelTracks,
  channels,
  devices,
  locationChannelEntitlements,
  locationChannelGrants,
  locationChannelVisibility,
  locationServiceAccess,
  locations,
  organizationMembers,
  organizations,
  users,
} from "../../db/v2/schema";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { validateCustomerProvisioningInput } from "../../db/v2/services/customerProvisioning";
import { getTimeZoneOptions } from "../../lib/v2/timeZones";

async function captureBaseline() {
  const [target, organizationCount, locationCount, userCount, memberCount, deviceCount, serviceAccessCount, entitlementCount, visibilityCount, channelCount, trackCount, migrationCount, base, grants, visibility, soundSpaFixture, yuryFixture] = await Promise.all([
    v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(organizations),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(locations),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(users),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(organizationMembers),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(devices),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(locationServiceAccess),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelEntitlements),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelVisibility),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(channels),
    v2Db.select({ count: sql<number>`count(*)::int` }).from(channelTracks),
    v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`),
    v2Db.select({ channelId: baseChannels.channelId }).from(baseChannels).orderBy(asc(baseChannels.channelId)),
    v2Db.select({ locationId: locationChannelGrants.locationId, channelId: locationChannelGrants.channelId, source: locationChannelGrants.source, enabled: locationChannelGrants.enabled, startsAt: locationChannelGrants.startsAt, endsAt: locationChannelGrants.endsAt }).from(locationChannelGrants).orderBy(asc(locationChannelGrants.locationId), asc(locationChannelGrants.channelId), asc(locationChannelGrants.source)),
    v2Db.select({ locationId: locationChannelVisibility.locationId, channelId: locationChannelVisibility.channelId, hidden: locationChannelVisibility.hidden }).from(locationChannelVisibility).orderBy(asc(locationChannelVisibility.locationId), asc(locationChannelVisibility.channelId)),
    v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, "SoundSpa Test")),
    v2Db.select({ id: locations.id, organizationId: locations.organizationId, slug: locations.slug }).from(locations).where(eq(locations.name, "Yury Test Spa")),
  ]);
  assert.equal(target.rows[0]?.database, "soundspa_v2");
  assert.equal(target.rows[0]?.user, "soundspa_v2");
  assert.equal(migrationCount.rows[0]?.count, 9);
  return {
    counts: {
      organizations: organizationCount[0].count,
      locations: locationCount[0].count,
      users: userCount[0].count,
      members: memberCount[0].count,
      devices: deviceCount[0].count,
      serviceAccess: serviceAccessCount[0].count,
      entitlements: entitlementCount[0].count,
      visibility: visibilityCount[0].count,
      channels: channelCount[0].count,
      tracks: trackCount[0].count,
      migrations: migrationCount.rows[0]?.count,
    },
    base: base.map((row) => row.channelId),
    grants,
    visibility,
    soundSpaFixture: soundSpaFixture.map((row) => row.id),
    yuryFixture,
  };
}

async function cleanupCustomerByName(name: string) {
  const matchingOrganizations = await v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, name));
  for (const organization of matchingOrganizations) {
    const organizationLocations = await v2Db.select({ id: locations.id }).from(locations).where(eq(locations.organizationId, organization.id));
    for (const location of organizationLocations) {
      await v2Db.delete(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, location.id));
      await v2Db.delete(locationChannelGrants).where(eq(locationChannelGrants.locationId, location.id));
      await v2Db.delete(locationChannelEntitlements).where(eq(locationChannelEntitlements.locationId, location.id));
      await v2Db.delete(locationServiceAccess).where(eq(locationServiceAccess.locationId, location.id));
      await v2Db.delete(devices).where(eq(devices.locationId, location.id));
      await v2Db.delete(locations).where(eq(locations.id, location.id));
    }
    await v2Db.delete(organizationMembers).where(eq(organizationMembers.organizationId, organization.id));
    await v2Db.delete(organizations).where(eq(organizations.id, organization.id));
  }
  assert.equal((await v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, name))).length, 0);
}

async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to authorize the controlled isolated staging verification.");
  const username = process.env.V2_ADMIN_USERNAME;
  const password = process.env.V2_ADMIN_PASSWORD;
  assert(username && password, "Staging operator authorization must be configured.");
  const origin = process.env.V2_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
  const publicOrigin = new URL(process.env.V2_PUBLIC_ORIGIN || origin).origin;
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const baseline = await captureBaseline();
  const suffix = randomUUID();
  const organizationName = `Gate 3A verification ${suffix}`;
  const duplicateOrganizationName = `Gate 3A duplicate ${suffix}`;
  const input = {
    organizationName: `  ${organizationName}  `,
    locationName: `  First Location ${suffix}  `,
    slug: `gate-3a-${suffix}`,
    timezone: "Asia/Ho_Chi_Minh",
  };
  const testBase = await v2Db.select({ id: channels.id }).from(channels).where(and(eq(channels.isPublished, true), isNull(channels.archivedAt))).orderBy(asc(channels.sortOrder), asc(channels.id));
  const baseIds = new Set(baseline.base);
  const baseChannel = testBase.find(({ id }) => baseIds.has(id));
  const nonBaseChannel = testBase.find(({ id }) => !baseIds.has(id));
  assert(baseChannel && nonBaseChannel, "Staging must have a current Base and a non-Base published Channel for access checks.");
  const otherLocation = (await v2Db.select({ id: locations.id }).from(locations).where(isNull(locations.archivedAt)).orderBy(asc(locations.id)))[0];
  const extraTimezoneOrganizations: string[] = [];
  assert(otherLocation, "Existing technical Location fixture is required for isolation checks.");

  try {
    const timeZoneOptions = getTimeZoneOptions();
    for (const timezone of ["Asia/Ho_Chi_Minh", "Europe/Moscow", "Asia/Bangkok"]) {
      assert(timeZoneOptions.includes(timezone), `${timezone} must be available in the timezone selector.`);
      assert.equal(validateCustomerProvisioningInput({ ...input, timezone }).timezone, timezone, "The canonical IANA value must reach server-side validation unchanged.");
    }

    const unauthAdmin = await fetch(`${origin}/admin`, { redirect: "manual" });
    assert.equal(unauthAdmin.status, 401);
    assert.match(unauthAdmin.headers.get("www-authenticate") ?? "", /^Basic\s/i);
    const unauthAdminUi = await fetch(`${origin}/admin/ui`, { redirect: "manual" });
    assert.equal(unauthAdminUi.status, 401);
    assert.match(unauthAdminUi.headers.get("www-authenticate") ?? "", /^Basic\s/i);
    const deviceCookieAdmin = await fetch(`${origin}/admin/ui`, { headers: { cookie: "soundspa_v2_device=not-an-operator-credential" }, redirect: "manual" });
    assert.equal(deviceCookieAdmin.status, 401);
    const adminRedirect = await fetch(`${origin}/admin`, { headers: { authorization }, redirect: "manual" });
    assert.equal(adminRedirect.status, 307);
    assert.equal(adminRedirect.headers.get("location"), "/admin/ui");
    assert.equal((await fetch(`${origin}/admin/ui`, { headers: { authorization } })).status, 200);
    const noAuth = await fetch(`${origin}/api/v2/admin/customers`, { method: "POST", headers: { origin: publicOrigin, "content-type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(noAuth.status, 401);
    const cookieOnly = await fetch(`${origin}/api/v2/admin/customers`, { method: "POST", headers: { origin: publicOrigin, cookie: "soundspa_v2_device=not-an-operator-credential", "content-type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(cookieOnly.status, 401);
    const crossOrigin = await fetch(`${origin}/api/v2/admin/customers`, { method: "POST", headers: { authorization, origin: "https://untrusted.invalid", "content-type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(crossOrigin.status, 403);

    const invalidRequests: unknown[] = [
      { ...input, slug: "invalid/slug" },
      { ...input, organizationName: "   " },
      { ...input, locationName: "   " },
      { ...input, timezone: "Not/A_Time_Zone" },
    ];
    for (const body of invalidRequests) {
      const response = await fetch(`${origin}/api/v2/admin/customers`, { method: "POST", headers: { authorization, origin: publicOrigin, "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
    assert.equal((await v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, organizationName))).length, 0);

    const [existingLocation] = await v2Db.select({ slug: locations.slug }).from(locations).limit(1);
    assert(existingLocation);
    const duplicate = await fetch(`${origin}/api/v2/admin/customers`, { method: "POST", headers: { authorization, origin: publicOrigin, "content-type": "application/json" }, body: JSON.stringify({ ...input, organizationName: duplicateOrganizationName, slug: existingLocation.slug }) });
    assert.equal(duplicate.status, 409);
    const duplicateBody = await duplicate.json() as { message?: string };
    assert(duplicateBody.message?.includes("already in use"));
    assert(!JSON.stringify(duplicateBody).includes("locations_slug_unique"));
    assert.equal((await v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, duplicateOrganizationName))).length, 0, "Failed Location insert must roll back its new Organization.");

    const unauthorizedAccess = await fetch(`${origin}/api/v2/admin/access`, { method: "POST", headers: { origin: publicOrigin, "content-type": "application/x-www-form-urlencoded" }, body: "operation=show-channel" });
    assert.equal(unauthorizedAccess.status, 401);
    const crossOriginAccess = await fetch(`${origin}/api/v2/admin/access`, { method: "POST", headers: { authorization, origin: "https://untrusted.invalid", "content-type": "application/x-www-form-urlencoded" }, body: "operation=show-channel" });
    assert.equal(crossOriginAccess.status, 403);

    const created = await fetch(`${origin}/api/v2/admin/customers`, { method: "POST", headers: { authorization, origin: publicOrigin, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(input) });
    assert.equal(created.status, 201);
    const result = await created.json() as { ok: boolean; organizationId: string; locationId: string };
    assert.equal(result.ok, true);
    const [createdOrganization] = await v2Db.select().from(organizations).where(eq(organizations.id, result.organizationId));
    const [createdLocation] = await v2Db.select().from(locations).where(eq(locations.id, result.locationId));
    assert.equal(createdOrganization.name, organizationName);
    assert.equal(createdLocation.organizationId, createdOrganization.id);
    assert.equal(createdLocation.name, `First Location ${suffix}`);
    assert.equal(createdLocation.slug, input.slug);
    assert.equal(createdLocation.timezone, input.timezone);

    for (const timezone of ["Europe/Moscow", "Asia/Bangkok"]) {
      const extraOrganizationName = `Gate 3A timezone ${timezone} ${suffix}`;
      extraTimezoneOrganizations.push(extraOrganizationName);
      const timezoneResponse = await fetch(`${origin}/api/v2/admin/customers`, { method: "POST", headers: { authorization, origin: publicOrigin, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ ...input, organizationName: extraOrganizationName, locationName: `Timezone test ${timezone}`, slug: `${input.slug}-${timezone.toLowerCase().replaceAll("_", "-").replaceAll("/", "-")}`, timezone }) });
      assert.equal(timezoneResponse.status, 201);
      const timezoneResult = await timezoneResponse.json() as { locationId: string };
      const [timezoneLocation] = await v2Db.select({ timezone: locations.timezone }).from(locations).where(eq(locations.id, timezoneResult.locationId));
      assert.equal(timezoneLocation.timezone, timezone, "The selected canonical IANA identifier must be stored unchanged.");
    }

    const customersPage = await fetch(`${origin}/admin/ui`, { headers: { authorization } });
    assert.equal(customersPage.status, 200);
    const customerHtml = await customersPage.text();
    assert(customerHtml.includes(organizationName));
    assert(customerHtml.includes(`Open Location`));
    const detailPage = await fetch(`${origin}/admin/ui?location=${encodeURIComponent(createdLocation.id)}`, { headers: { authorization } });
    assert.equal(detailPage.status, 200);
    const detailHtml = await detailPage.text();
    assert(detailHtml.includes(organizationName));
    assert(detailHtml.includes(createdLocation.name));
    assert(detailHtml.includes(createdLocation.slug));
    assert(detailHtml.includes("Effective playable channels"));
    assert(detailHtml.includes("Open Player Preview"));
    assert(detailHtml.includes(`/admin/ui/locations/${createdLocation.id}/player-preview`));
    const syntheticPreview = await fetch(`${origin}/admin/ui/locations/${createdLocation.id}/player-preview`, { headers: { authorization } });
    assert.equal(syntheticPreview.status, 200);
    const syntheticPreviewHtml = await syntheticPreview.text();
    assert(syntheticPreviewHtml.includes(`>${createdOrganization.name}</div>`), "Operator Preview must use the Organization as the shared player's primary brand.");
    assert(syntheticPreviewHtml.includes(`>${createdLocation.name}</div>`), "Operator Preview must show the Location as the shared player's secondary brand.");
    assert(!syntheticPreviewHtml.includes("Sound Spa 2"), "Customer-context preview must not show the technical player title.");
    assert(!syntheticPreviewHtml.includes("Local prototype"), "Customer-context preview must not show technical prototype branding.");

    assert.equal((await v2Db.select({ id: users.id }).from(users)).length, baseline.counts.users);
    assert.equal((await v2Db.select({ organizationId: organizationMembers.organizationId }).from(organizationMembers).where(eq(organizationMembers.organizationId, createdOrganization.id))).length, 0);
    assert.equal((await v2Db.select({ id: devices.id }).from(devices).where(eq(devices.locationId, createdLocation.id))).length, 0);
    assert.equal((await v2Db.select({ locationId: locationServiceAccess.locationId }).from(locationServiceAccess).where(eq(locationServiceAccess.locationId, createdLocation.id))).length, 0);
    assert.equal((await v2Db.select({ channelId: locationChannelEntitlements.channelId }).from(locationChannelEntitlements).where(eq(locationChannelEntitlements.locationId, createdLocation.id))).length, 0);
    assert.equal((await v2Db.select({ channelId: locationChannelGrants.channelId }).from(locationChannelGrants).where(eq(locationChannelGrants.locationId, createdLocation.id))).length, 0);
    assert.equal((await v2Db.select({ channelId: locationChannelVisibility.channelId }).from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, createdLocation.id))).length, 0);

    const newLocationAccess = await resolveEffectiveChannelAccess(createdLocation.id, new Date());
    const baseAccess = newLocationAccess.find(({ id }) => id === baseChannel.id);
    const lockedAccess = newLocationAccess.find(({ id }) => id === nonBaseChannel.id);
    assert(baseAccess?.playable && baseAccess.accessSources.includes("base"));
    assert(lockedAccess && !lockedAccess.playable && lockedAccess.tracks.length === 0);
    const defaultHidden = new Set(await v2Db.select({ id: locationChannelVisibility.channelId }).from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, createdLocation.id)).then((rows) => rows.map(({ id }) => id)));
    assert.equal(defaultHidden.size, 0, "New Locations are default-visible through sparse visibility semantics.");

    const otherBefore = (await resolveEffectiveChannelAccess(otherLocation.id, new Date())).find(({ id }) => id === nonBaseChannel.id);
    async function visibilityMutation(operation: "hide-channel" | "show-channel") {
      return fetch(`${origin}/api/v2/admin/access`, { method: "POST", headers: { authorization, origin: publicOrigin, accept: "application/json" }, body: new URLSearchParams({ operation, locationId: createdLocation.id, channelId: nonBaseChannel!.id }) });
    }
    assert.equal((await visibilityMutation("hide-channel")).status, 200);
    assert((await v2Db.select({ channelId: locationChannelVisibility.channelId }).from(locationChannelVisibility).where(and(eq(locationChannelVisibility.locationId, createdLocation.id), eq(locationChannelVisibility.channelId, nonBaseChannel.id)))).length === 1);
    assert.deepEqual((await resolveEffectiveChannelAccess(otherLocation.id, new Date())).find(({ id }) => id === nonBaseChannel.id), otherBefore);
    assert.equal((await visibilityMutation("show-channel")).status, 200);
    assert.equal((await v2Db.select({ channelId: locationChannelVisibility.channelId }).from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, createdLocation.id))).length, 0);

    const enableAdmin = await fetch(`${origin}/api/v2/admin/access`, { method: "POST", headers: { authorization, origin: publicOrigin, accept: "application/json" }, body: new URLSearchParams({ operation: "enable-admin", locationId: createdLocation.id, channelId: nonBaseChannel.id }) });
    assert.equal(enableAdmin.status, 200);
    const adminAccess = (await resolveEffectiveChannelAccess(createdLocation.id, new Date())).find(({ id }) => id === nonBaseChannel.id);
    assert(adminAccess?.playable && adminAccess.accessSources.includes("admin"));
    assert.deepEqual((await resolveEffectiveChannelAccess(otherLocation.id, new Date())).find(({ id }) => id === nonBaseChannel.id), otherBefore);
    const disableAdmin = await fetch(`${origin}/api/v2/admin/access`, { method: "POST", headers: { authorization, origin: publicOrigin, accept: "application/json" }, body: new URLSearchParams({ operation: "disable-admin", locationId: createdLocation.id, channelId: nonBaseChannel.id }) });
    assert.equal(disableAdmin.status, 200);
    const disabledAccess = (await resolveEffectiveChannelAccess(createdLocation.id, new Date())).find(({ id }) => id === nonBaseChannel.id);
    assert(disabledAccess && !disabledAccess.playable);
    assert.deepEqual((await resolveEffectiveChannelAccess(otherLocation.id, new Date())).find(({ id }) => id === nonBaseChannel.id), otherBefore);

    console.info("V2 Customer Provisioning HTTP PASS: authenticated atomic Organization+Location creation, controlled validation/duplicate-slug rollback, fixture/list/detail visibility, no automatic User/member/Device/access rows, dynamic Base and Locked behavior, Location-scoped hide/show/Admin Override, isolation, and auth/CSRF.");
  } finally {
    try {
      await cleanupCustomerByName(organizationName);
      await cleanupCustomerByName(duplicateOrganizationName);
      for (const name of extraTimezoneOrganizations) await cleanupCustomerByName(name);
      const after = await captureBaseline();
      assert.deepEqual(after, baseline, "Staging live state must exactly return to its captured pre-test state.");
    } finally {
      await v2Pool.end();
    }
  }
}

main().catch((error) => {
  console.error(`V2 Customer Provisioning verification failed: ${error instanceof Error && error.name === "AssertionError" ? error.message.slice(0, 240) : "details suppressed"}`);
  process.exitCode = 1;
});
