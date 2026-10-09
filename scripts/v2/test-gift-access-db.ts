import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

function assertDisposableLocalTarget(databaseUrl: string): URL {
  const parsed = new URL(databaseUrl);
  if (process.env.V2_GIFT_ACCESS_TEST_ALLOW_DATABASE !== "1" ||
      !new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) ||
      decodeURIComponent(parsed.pathname) !== "/soundspa_v2") {
    throw new Error("Refusing Gift Access integration test: require explicit opt-in and a loopback soundspa_v2 database.");
  }
  return parsed;
}

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) throw new Error("V2_DATABASE_URL must point to a disposable local PostgreSQL database.");
  const target = assertDisposableLocalTarget(databaseUrl);
  process.env.V2_ADMIN_USERNAME = "local-integration-operator";
  process.env.V2_ADMIN_PASSWORD = "gift-access-local-operator-test-secret";
  const operatorAuthorization = `Basic ${Buffer.from(`${process.env.V2_ADMIN_USERNAME}:${process.env.V2_ADMIN_PASSWORD}`).toString("base64")}`;
  const [{ v2Db, v2Pool }, schema, gifts, adminGrants, effectiveAccess] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/giftAccess"),
    import("../../db/v2/queries/adminGrants"),
    import("../../db/v2/queries/effectiveAccess"),
  ]);

  const identity = await v2Pool.query<{ database: string; role: string; address: string | null; migrationCount: string; latestMigration: string }>(
    "SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, (SELECT count(*) FROM drizzle_v2.__drizzle_migrations)::text AS \"migrationCount\", (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS \"latestMigration\"",
  );
  const database = identity.rows[0];
  const address = database?.address?.split("/")[0] ?? "";
  if (!database || database.database !== "soundspa_v2" || !new Set(["127.0.0.1", "::1"]).has(address) || isIP(address) === 0 ||
      decodeURIComponent(target.username) === "soundspa_v2" || database.role !== decodeURIComponent(target.username) ||
      Number(database.migrationCount) !== 18 || database.latestMigration !== "1791526957000") {
    throw new Error("Database is not the expected disposable loopback database at Gift Access migration 0017.");
  }
  const baseline = await v2Pool.query<{ count: string }>(
    "SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM organization_members) + (SELECT count(*) FROM location_channel_grants) + (SELECT count(*) FROM gift_access_invitations) + (SELECT count(*) FROM organization_channel_gift_grants) AS count",
  );
  if (baseline.rows[0]?.count !== "0") throw new Error("Disposable Gift Access database must contain no customer or gift fixtures before the test.");

  let assertionCount = 0;
  const check = (condition: unknown, message: string) => { assert.ok(condition, message); assertionCount += 1; };
  const expectGiftError = async (operation: Promise<unknown>, code: string) => {
    await assert.rejects(operation, (error: unknown) => error instanceof gifts.GiftAccessError && error.code === code);
    assertionCount += 1;
  };
  const suffix = randomUUID();
  const now = new Date();
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let channelIds: string[] = [];
  let locationId: string | null = null;

  try {
    const organizations = await v2Db.insert(schema.organizations).values([
      { name: `gift-access-a-${suffix}` },
      { name: `gift-access-b-${suffix}` },
    ]).returning();
    organizationIds.push(...organizations.map((row) => row.id));
    const users = await v2Db.insert(schema.users).values([
      { email: `gift-owner-${suffix}@example.test`, emailVerifiedAt: now },
      { email: `gift-admin-${suffix}@example.test`, emailVerifiedAt: now },
      { email: `gift-manager-${suffix}@example.test`, emailVerifiedAt: now },
      { email: `gift-unverified-${suffix}@example.test` },
      { email: `gift-owner-b-${suffix}@example.test`, emailVerifiedAt: now },
    ]).returning();
    userIds.push(...users.map((row) => row.id));
    const [owner, admin, manager, unverified, ownerB] = users;
    await v2Db.insert(schema.organizationMembers).values([
      { organizationId: organizations[0].id, userId: owner.id, role: "owner" },
      { organizationId: organizations[0].id, userId: admin.id, role: "admin" },
      { organizationId: organizations[0].id, userId: manager.id, role: "manager" },
      { organizationId: organizations[0].id, userId: unverified.id, role: "owner" },
      { organizationId: organizations[1].id, userId: ownerB.id, role: "owner" },
    ]);
    const channels = await v2Db.insert(schema.channels).values([
      { slug: `gift-access-${suffix.slice(0, 8)}`, displayName: "Gift Access Test", kind: "music", isPublished: true },
      { slug: `gift-access-other-${suffix.slice(0, 8)}`, displayName: "Gift Access Other", kind: "ambient", isPublished: true },
    ]).returning();
    channelIds = channels.map((row) => row.id);
    const [location] = await v2Db.insert(schema.locations).values({
      organizationId: organizations[0].id,
      name: "Gift Access Test Location",
      slug: `gift-access-${suffix.slice(0, 8)}`,
      timezone: "UTC",
      marketCode: "US",
    }).returning();
    locationId = location.id;
    await v2Db.insert(schema.locationChannelGrants).values({ locationId: location.id, channelId: channels[0].id, source: "admin", enabled: true });
    const beforeAccess = await effectiveAccess.resolveEffectiveChannelAccess(location.id, now);
    check(beforeAccess.some((item) => item.id === channels[0].id && item.playable && item.accessSources.includes("admin")), "Location Admin Grant must provide the existing effective access");

    const issue = (channelId = channels[0].id, duration: "3_months" | "6_months" | "12_months" | "indefinite" = "3_months", deadline?: Date, issuedAt = now) => gifts.createGiftAccessInvitation({
      channelId, duration, redemptionDeadline: deadline, operatorAuthorization,
    }, undefined, issuedAt);
    const redeem = (token: string, organizationId = organizations[0].id, authenticatedUserId = owner.id, redeemedAt = now) => gifts.redeemGiftAccessInvitation({
      token, organizationId, authenticatedUserId,
    }, undefined, redeemedAt);

    await expectGiftError(gifts.createGiftAccessInvitation({
      channelId: channels[0].id, duration: "3_months", operatorAuthorization: "Basic invalid-operator-credentials",
    }), "NOT_AUTHORIZED");
    for (const member of [owner, admin, manager]) {
      const memberAuthorization = `Basic ${Buffer.from(`${member.email}:not-an-operator-password`).toString("base64")}`;
      await expectGiftError(gifts.createGiftAccessInvitation({
        channelId: channels[0].id, duration: "3_months", operatorAuthorization: memberAuthorization,
      }), "NOT_AUTHORIZED");
    }
    const managerInvite = await issue();
    await expectGiftError(redeem(managerInvite.token, organizations[0].id, manager.id), "NOT_AUTHORIZED");
    await expectGiftError(redeem(managerInvite.token, organizations[0].id, unverified.id), "NOT_AUTHORIZED");

    const deadline = new Date(now.getTime() + 60 * 60 * 1000);
    const expiredInvite = await issue(channels[0].id, "3_months", deadline);
    await expectGiftError(redeem(expiredInvite.token, organizations[0].id, owner.id, new Date(deadline.getTime() + 1)), "INVITATION_UNAVAILABLE");

    const revokedInvite = await issue();
    await expectGiftError(gifts.revokeGiftAccessInvitation(revokedInvite.invitation.id, "Basic invalid-operator-credentials"), "NOT_AUTHORIZED");
    await gifts.revokeGiftAccessInvitation(revokedInvite.invitation.id, operatorAuthorization, undefined, now);
    await expectGiftError(redeem(revokedInvite.token), "INVITATION_UNAVAILABLE");

    const first = await issue(channels[0].id, "3_months");
    const firstRedemption = await redeem(first.token, organizations[0].id, admin.id, new Date(now.getTime() + 1));
    const second = await issue(channels[0].id, "6_months");
    const secondRedemption = await redeem(second.token, organizations[0].id, owner.id, new Date(now.getTime() + 2));
    const third = await issue(channels[0].id, "3_months");
    const thirdRedemption = await redeem(third.token, organizations[0].id, owner.id, new Date(now.getTime() + 3));
    check(firstRedemption.grant.endsAt !== null && firstRedemption.grant.endsAt > firstRedemption.grant.startsAt, "finite grant should persist its calendar expiry");
    check(secondRedemption.grant.startsAt.getTime() === firstRedemption.grant.endsAt?.getTime(), "repeated gift must extend from existing finite expiry");
    check(thirdRedemption.grant.startsAt.getTime() === secondRedemption.grant.endsAt?.getTime(), "a later gift must extend the preceding finite gift");
    await expectGiftError(redeem(first.token), "INVITATION_UNAVAILABLE");
    await expectGiftError(gifts.revokeGiftAccessInvitation(first.invitation.id, operatorAuthorization), "ALREADY_REDEEMED");

    const beforeGiftRevoke = await effectiveAccess.resolveEffectiveChannelAccess(location.id, now);
    check(JSON.stringify(beforeGiftRevoke) === JSON.stringify(beforeAccess), "Gift redemption must not alter the current Location channel authorization result");
    await expectGiftError(gifts.revokeOrganizationChannelGiftGrant(firstRedemption.grant.id, "Basic invalid-operator-credentials"), "NOT_AUTHORIZED");
    const revokedGrant = await gifts.revokeOrganizationChannelGiftGrant(firstRedemption.grant.id, operatorAuthorization, undefined, new Date(now.getTime() + 10));
    check(revokedGrant.rescheduledGrantIds.includes(secondRedemption.grant.id) && revokedGrant.rescheduledGrantIds.includes(thirdRedemption.grant.id), "revocation should reschedule unexpired later gifts");
    const [updatedSecond] = await v2Db.select().from(schema.organizationChannelGiftGrants).where(eq(schema.organizationChannelGiftGrants.id, secondRedemption.grant.id));
    check(updatedSecond.startsAt.getTime() === now.getTime() + 10, "first remaining finite gift should start at revocation time");
    const [stillIndependent] = await v2Db.select().from(schema.organizationChannelGiftGrants).where(eq(schema.organizationChannelGiftGrants.id, thirdRedemption.grant.id));
    check(stillIndependent.revokedAt === null, "revoking one gift must preserve later gift records");
    const activeAfterRevoke = await gifts.getActiveOrganizationChannelGiftAccess(organizations[0].id, channels[0].id, new Date(now.getTime() + 11));
    check(activeAfterRevoke?.kind === "finite" && activeAfterRevoke.grantIds.includes(secondRedemption.grant.id), "another gift must remain independently effective");
    const afterGiftRevoke = await effectiveAccess.resolveEffectiveChannelAccess(location.id, now);
    check(JSON.stringify(afterGiftRevoke) === JSON.stringify(beforeAccess), "Gift revocation must leave the Location Admin Grant channel result unchanged");
    const [adminGrant] = await adminGrants.getLocationAdminGrants(location.id);
    check(adminGrant?.grant.enabled === true, "gift revocation must not disable the Location Admin Grant");

    const infinite = await issue(channels[1].id, "indefinite");
    const finite = await issue(channels[1].id, "3_months");
    const infiniteRedemption = await redeem(infinite.token, organizations[0].id, owner.id, new Date(now.getTime() + 20));
    const finiteRedemption = await redeem(finite.token, organizations[0].id, owner.id, new Date(now.getTime() + 21));
    const dominant = await gifts.getActiveOrganizationChannelGiftAccess(organizations[0].id, channels[1].id, new Date(now.getTime() + 22));
    check(dominant?.kind === "indefinite", "an active indefinite gift must dominate finite gifts");
    await gifts.revokeOrganizationChannelGiftGrant(infiniteRedemption.grant.id, operatorAuthorization, undefined, new Date(now.getTime() + 23));
    const finiteAfterRevoke = await gifts.getActiveOrganizationChannelGiftAccess(organizations[0].id, channels[1].id, new Date(now.getTime() + 24));
    check(finiteAfterRevoke?.kind === "finite" && finiteAfterRevoke.grantIds.includes(finiteRedemption.grant.id), "finite access must remain independent after revoking indefinite access");

    const concurrent = await issue(channels[1].id, "3_months");
    const attempts = await Promise.allSettled([
      redeem(concurrent.token, organizations[0].id, owner.id, new Date(now.getTime() + 30)),
      redeem(concurrent.token, organizations[1].id, ownerB.id, new Date(now.getTime() + 30)),
    ]);
    check(attempts.filter((attempt) => attempt.status === "fulfilled").length === 1, "concurrent redemption must allow exactly one Organization");
    check(attempts.filter((attempt) => attempt.status === "rejected" && attempt.reason instanceof gifts.GiftAccessError && attempt.reason.code === "INVITATION_UNAVAILABLE").length === 1, "the losing concurrent redemption must fail as unavailable");
    const [storedConcurrentInvite] = await v2Db.select().from(schema.giftAccessInvitations).where(eq(schema.giftAccessInvitations.id, concurrent.invitation.id));
    check(storedConcurrentInvite.redeemedOrganizationId !== null, "the winning Organization must be recorded on the invitation");
    check(storedConcurrentInvite.tokenHash !== concurrent.token, "only a token hash must be stored");

    console.log(`Gift Access PostgreSQL integration passed (${assertionCount} assertions).`);
  } finally {
    await v2Pool.query("DELETE FROM organization_channel_gift_grants WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
    await v2Pool.query("DELETE FROM gift_access_invitations WHERE created_by_operator = $1", ["local-integration-operator"]);
    if (locationId) await v2Pool.query("DELETE FROM location_channel_grants WHERE location_id = $1", [locationId]);
    if (locationId) await v2Pool.query("DELETE FROM locations WHERE id = $1", [locationId]);
    if (organizationIds.length) await v2Pool.query("DELETE FROM organization_members WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
    if (organizationIds.length) await v2Pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
    if (userIds.length) await v2Pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    if (channelIds.length) await v2Pool.query("DELETE FROM channels WHERE id = ANY($1::uuid[])", [channelIds]);
    await v2Pool.end();
  }
}

await main();
