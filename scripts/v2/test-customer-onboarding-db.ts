import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testUrl = process.env.V2_ONBOARDING_TEST_DATABASE_URL;
assert(testUrl, "Set V2_ONBOARDING_TEST_DATABASE_URL to an isolated local V2 test database.");
const parsedUrl = new URL(testUrl);
assert(["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname), "Onboarding DB tests are restricted to a local loopback database.");
assert.equal(decodeURIComponent(parsedUrl.pathname), "/soundspa_v2", "The test database must use the V2 database name.");
process.env.V2_DATABASE_URL = testUrl;

const [{ v2Db }, schema, { completeOrdinaryCustomerOnboarding, CustomerOnboardingError }, { startSoundSpaTrial }] = await Promise.all([
  import("../../db/v2/client"),
  import("../../db/v2/schema"),
  import("../../db/v2/services/customerOnboarding"),
  import("../../db/v2/queries/coreTrials"),
]);
const { eq } = await import("drizzle-orm");
const fixture = randomUUID();
const expectedError = (code: string) => (error: unknown) => error instanceof CustomerOnboardingError && error.code === code;

try {
  await v2Db.transaction(async (outer) => {
    const [user] = await outer.insert(schema.users).values({ email: `onboarding-${fixture}@example.invalid`, emailVerifiedAt: new Date() }).returning();
    const [intent] = await outer.insert(schema.customerSignupIntents).values({
      email: user.email, locale: "en", expiresAt: new Date(Date.now() + 60_000), verifiedAt: new Date(), completedAt: new Date(),
    }).returning();
    const input = { authenticatedUserId: user.id, signupIntentId: intent.id, organizationName: `Onboarding ${fixture}`, locationName: "First Location", timezone: "Asia/Ho_Chi_Minh" };
    const runInTransaction = <T>(operation: (tx: typeof outer) => Promise<T>) => outer.transaction(operation);

    await assert.rejects(completeOrdinaryCustomerOnboarding({ ...input, authenticatedUserId: randomUUID() }, { runInTransaction }), expectedError("unauthenticated"));
    const [unverified] = await outer.insert(schema.users).values({ email: `unverified-${fixture}@example.invalid` }).returning();
    await assert.rejects(completeOrdinaryCustomerOnboarding({ ...input, authenticatedUserId: unverified.id }, { runInTransaction }), expectedError("unverified"));

    const legacyPartnerVerifiedAt = new Date();
    const [partnerIntent] = await outer.insert(schema.customerSignupIntents).values({
      email: user.email, locale: "en", inviteTokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000), verifiedAt: legacyPartnerVerifiedAt, completedAt: legacyPartnerVerifiedAt,
    }).returning();
    await assert.rejects(completeOrdinaryCustomerOnboarding({ ...input, signupIntentId: partnerIntent.id }, { runInTransaction }), expectedError("partner_context"));
    await assert.rejects(completeOrdinaryCustomerOnboarding({ ...input, signupIntentId: null }, { runInTransaction }), expectedError("partner_context"), "Partner context must remain protected after a later login without the original session intent id.");
    assert.equal((await outer.select({ id: schema.organizationMembers.organizationId }).from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, user.id))).length, 0, "Partner context must not create an owner membership or trial.");

    const [preverificationUser] = await outer.insert(schema.users).values({ email: `preverification-partner-${fixture}@example.invalid`, emailVerifiedAt: new Date() }).returning();
    const [preverificationIntent] = await outer.insert(schema.customerSignupIntents).values({
      email: preverificationUser.email, locale: "en", inviteTokenHash: "b".repeat(64), expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    await assert.rejects(completeOrdinaryCustomerOnboarding({ ...input, authenticatedUserId: preverificationUser.id, signupIntentId: preverificationIntent.id }, { runInTransaction }), expectedError("partner_context"), "A pending Partner intent must not fall through before its email auth link is consumed.");
    assert.equal((await outer.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, preverificationUser.id))).length, 0);

    const created = await completeOrdinaryCustomerOnboarding(input, { runInTransaction, createTrial: (locationId, tx) => startSoundSpaTrial(locationId, tx) });
    assert.equal(created.status, "completed");
    assert.equal(created.account.organization.name, `Onboarding ${fixture}`);
    assert.equal(created.account.location.timezone, "Asia/Ho_Chi_Minh");
    assert.equal(created.account.trial?.status, "active");
    assert.equal(created.account.trial!.endsAt.getTime() - created.account.trial!.startsAt.getTime(), 30 * 24 * 60 * 60 * 1000);
    const repeated = await completeOrdinaryCustomerOnboarding({ ...input, organizationName: "Ignored retry", locationName: "Ignored retry", timezone: "Europe/Moscow" }, { runInTransaction });
    assert.equal(repeated.status, "already_complete");
    assert(repeated.account.organization && created.account.organization);
    assert.equal(repeated.account.organization.id, created.account.organization.id);
    assert.equal((await outer.select({ role: schema.organizationMembers.role }).from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, user.id))).length, 1);
    assert.equal((await outer.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, created.account.location.id))).length, 1);
    assert.equal((await outer.select({ id: schema.locationChannelGrants.channelId }).from(schema.locationChannelGrants).where(eq(schema.locationChannelGrants.locationId, created.account.location.id))).length, 0);
    assert.equal((await outer.select({ id: schema.locationChannelEntitlements.channelId }).from(schema.locationChannelEntitlements).where(eq(schema.locationChannelEntitlements.locationId, created.account.location.id))).length, 0);

    const [membershipFailureUser] = await outer.insert(schema.users).values({ email: `membership-failure-${fixture}@example.invalid`, emailVerifiedAt: new Date() }).returning();
    const membershipFailureInput = { ...input, authenticatedUserId: membershipFailureUser.id, signupIntentId: null, organizationName: `Membership rollback ${fixture}`, locationName: "Membership rollback Location" };
    await assert.rejects(completeOrdinaryCustomerOnboarding(membershipFailureInput, {
      runInTransaction,
      createOwnerMembership: async () => { throw new Error("forced membership failure"); },
    }), /forced membership failure/);
    assert.equal((await outer.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.name, membershipFailureInput.organizationName))).length, 0, "Membership failure must roll back Organization and Location.");
    assert.equal((await outer.select({ id: schema.organizationMembers.organizationId }).from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, membershipFailureUser.id))).length, 0);
    assert.equal((await outer.select({ id: schema.monitoringLifecycleEvents.id }).from(schema.monitoringLifecycleEvents).where(eq(schema.monitoringLifecycleEvents.organizationName, membershipFailureInput.organizationName))).length, 0);

    const [failingUser] = await outer.insert(schema.users).values({ email: `rollback-${fixture}@example.invalid`, emailVerifiedAt: new Date() }).returning();
    const failingInput = { ...input, authenticatedUserId: failingUser.id, signupIntentId: null, organizationName: `Rollback ${fixture}`, locationName: "Rollback Location" };
    await assert.rejects(completeOrdinaryCustomerOnboarding(failingInput, {
      runInTransaction,
      createTrial: async () => { throw new Error("forced trial failure"); },
    }), /forced trial failure/);
    assert.equal((await outer.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.name, failingInput.organizationName))).length, 0);
    assert.equal((await outer.select({ id: schema.organizationMembers.organizationId }).from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, failingUser.id))).length, 0, "Failed trial must roll back the new membership.");
    assert.equal((await outer.select({ id: schema.monitoringLifecycleEvents.id }).from(schema.monitoringLifecycleEvents).where(eq(schema.monitoringLifecycleEvents.organizationName, failingInput.organizationName))).length, 0);
    throw new Error("ONBOARDING_TEST_ROLLBACK");
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== "ONBOARDING_TEST_ROLLBACK") throw error;
  });
  console.info("V2 Customer Onboarding DB PASS: auth/verification guards, Partner context boundary, atomic owner+Location+canonical Basic Trial, 30-day duration, no manual grants, retry idempotency, and forced membership/trial-failure rollback (all fixtures rolled back).");
} finally {
  await v2Db.$client.end();
}
