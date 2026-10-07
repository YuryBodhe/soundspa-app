import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const testUrl = process.env.V2_ONBOARDING_TEST_DATABASE_URL;
assert(testUrl, "Set V2_ONBOARDING_TEST_DATABASE_URL to an isolated local V2 test database.");
const parsedUrl = new URL(testUrl);
assert(["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname), "Partner onboarding DB tests are restricted to a local loopback database.");
assert.equal(decodeURIComponent(parsedUrl.pathname), "/soundspa_v2", "The test database must use the V2 database name.");
process.env.V2_DATABASE_URL = testUrl;

const [{ v2Db }, schema, { completePartnerCustomerOnboarding, PartnerOnboardingError }] = await Promise.all([
  import("../../db/v2/client"),
  import("../../db/v2/schema"),
  import("../../db/v2/services/customerOnboarding"),
]);
const { and, eq } = await import("drizzle-orm");
const suffix = randomUUID();
const expectPartnerError = (code: string) => (error: unknown) => error instanceof PartnerOnboardingError && error.code === code;

try {
  await v2Db.transaction(async (outer) => {
    const runInTransaction = <T>(operation: (tx: typeof outer) => Promise<T>) => outer.transaction(operation);
    const ownerEmail = `p53-owner-${suffix}@example.invalid`;
    const verifiedAt = new Date(Date.now() - 1_000);
    const invitePlaintext = `p53-invite-${suffix}-${randomUUID()}`;
    const inviteHash = createHash("sha256").update(invitePlaintext).digest("hex");
    const [user] = await outer.insert(schema.users).values({ email: ownerEmail, emailVerifiedAt: verifiedAt }).returning();
    const [intent] = await outer.insert(schema.customerSignupIntents).values({
      email: ownerEmail, locale: "en", inviteTokenHash: inviteHash,
      expiresAt: new Date(Date.now() + 60 * 60_000), verifiedAt,
    }).returning();
    assert.equal(JSON.stringify(intent).includes(invitePlaintext), false, "Invite plaintext must not persist in signup intent.");

    const [partner] = await outer.insert(schema.commercialPartners).values({ code: `p53-${suffix}`, name: "P5.3 fixture partner" }).returning();
    const [benefitProduct] = await outer.insert(schema.commercialProducts).values({ code: `p53-benefit-${suffix}`, name: "P5.3 benefit", kind: "partner" }).returning();
    const [offerTrialProduct] = await outer.insert(schema.commercialProducts).values({ code: `p53-trial-${suffix}`, name: "P5.3 offer trial", kind: "core" }).returning();
    const [offer] = await outer.insert(schema.commercialOffers).values({ partnerId: partner.id, code: `p53-offer-${suffix}`, name: "P5.3 offer" }).returning();
    await outer.insert(schema.commercialOfferGrants).values([
      { offerId: offer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: null },
      { offerId: offer.id, productId: offerTrialProduct.id, grantType: "trial", durationDays: 14 },
    ]);
    const [invite] = await outer.insert(schema.commercialPartnerInvites).values({ offerId: offer.id, tokenHash: inviteHash }).returning();
    const [basicProduct] = await outer.select().from(schema.commercialProducts).where(eq(schema.commercialProducts.code, "soundspa"));
    assert(basicProduct, "SoundSpa Basic fixture prerequisite must be provisioned.");

    const input = {
      authenticatedUserId: user.id, signupIntentId: intent.id,
      organizationName: `P5.3 ${suffix}`, locationName: `Partner first location ${suffix}`, timezone: "Asia/Ho_Chi_Minh",
    };
    const completed = await completePartnerCustomerOnboarding(input, { runInTransaction });
    assert.equal(completed.status, "completed");
    assert.equal(completed.account.trial, null, "Partner onboarding itself does not create the ordinary Basic trial.");
    const locationId = completed.account.location!.id;

    const memberships = await outer.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, user.id));
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0]!.role, "owner");
    const locations = await outer.select().from(schema.locations).where(eq(schema.locations.organizationId, completed.account.organization!.id));
    assert.equal(locations.length, 1);
    assert.equal((await outer.select().from(schema.commercialPartnerInviteClaims).where(and(
      eq(schema.commercialPartnerInviteClaims.inviteId, invite.id), eq(schema.commercialPartnerInviteClaims.locationId, locationId),
    ))).length, 1);
    assert.equal((await outer.select().from(schema.commercialPartnerBenefits).where(and(
      eq(schema.commercialPartnerBenefits.partnerId, partner.id), eq(schema.commercialPartnerBenefits.productId, benefitProduct.id),
      eq(schema.commercialPartnerBenefits.locationId, locationId),
    ))).length, 1, "The canonical Offer-defined benefit must be created.");
    assert.equal((await outer.select().from(schema.locationCoreTrials).where(and(
      eq(schema.locationCoreTrials.locationId, locationId), eq(schema.locationCoreTrials.productId, offerTrialProduct.id),
    ))).length, 1, "An Offer-defined trial must be created by canonical P3.");
    assert.equal((await outer.select().from(schema.locationCoreTrials).where(and(
      eq(schema.locationCoreTrials.locationId, locationId), eq(schema.locationCoreTrials.productId, basicProduct.id),
    ))).length, 0, "No independent SoundSpa Basic trial may be added.");
    assert.equal((await outer.select().from(schema.locationChannelGrants).where(eq(schema.locationChannelGrants.locationId, locationId))).length, 0);
    assert.equal((await outer.select().from(schema.locationChannelEntitlements).where(eq(schema.locationChannelEntitlements.locationId, locationId))).length, 0);
    const [consumedIntent] = await outer.select().from(schema.customerSignupIntents).where(eq(schema.customerSignupIntents.id, intent.id));
    assert(consumedIntent.completedAt && consumedIntent.completedAt > consumedIntent.verifiedAt!, "Successful atomic completion must consume the intent after verification.");

    const retry = await completePartnerCustomerOnboarding({ ...input, organizationName: "Ignored retry", locationName: "Ignored retry", timezone: "UTC" }, { runInTransaction });
    assert.equal(retry.status, "already_complete");
    assert.equal((await outer.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, user.id))).length, 1);
    assert.equal((await outer.select().from(schema.locations).where(eq(schema.locations.organizationId, completed.account.organization!.id))).length, 1);
    assert.equal((await outer.select().from(schema.commercialPartnerInviteClaims).where(eq(schema.commercialPartnerInviteClaims.inviteId, invite.id))).length, 1);
    assert.equal((await outer.select().from(schema.commercialPartnerBenefits).where(eq(schema.commercialPartnerBenefits.locationId, locationId))).length, 1);

    const [unverified] = await outer.insert(schema.users).values({ email: `p53-unverified-${suffix}@example.invalid` }).returning();
    await assert.rejects(completePartnerCustomerOnboarding({ ...input, authenticatedUserId: unverified.id, signupIntentId: null }, { runInTransaction }), expectPartnerError("unverified"));
    await assert.rejects(completePartnerCustomerOnboarding({ ...input, authenticatedUserId: randomUUID(), signupIntentId: null }, { runInTransaction }), expectPartnerError("unauthenticated"));

    // A valid-looking but unknown hash exercises the post-creation P3 failure
    // boundary. All customer rows roll back and the signup intent stays usable.
    const failedEmail = `p53-failure-${suffix}@example.invalid`;
    const [failedUser] = await outer.insert(schema.users).values({ email: failedEmail, emailVerifiedAt: verifiedAt }).returning();
    const missingTokenHash = createHash("sha256").update(`missing-${suffix}`).digest("hex");
    const [failedIntent] = await outer.insert(schema.customerSignupIntents).values({
      email: failedEmail, locale: "en", inviteTokenHash: missingTokenHash,
      expiresAt: new Date(Date.now() + 60 * 60_000), verifiedAt,
    }).returning();
    const failedName = `P5.3 rollback ${suffix}`;
    const failedLocationName = `P5.3 rollback location ${suffix}`;
    await assert.rejects(completePartnerCustomerOnboarding({ ...input, authenticatedUserId: failedUser.id, signupIntentId: failedIntent.id, organizationName: failedName, locationName: failedLocationName }, { runInTransaction }), expectPartnerError("invite_unavailable"));
    assert.equal((await outer.select().from(schema.organizations).where(eq(schema.organizations.name, failedName))).length, 0);
    assert.equal((await outer.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, failedUser.id))).length, 0);
    assert.equal((await outer.select().from(schema.locations).where(eq(schema.locations.name, failedLocationName))).length, 0);
    const [unconsumed] = await outer.select().from(schema.customerSignupIntents).where(eq(schema.customerSignupIntents.id, failedIntent.id));
    assert.equal(unconsumed.completedAt, null, "Failed P3 claim must leave valid signup context unconsumed.");

    const [existingUser] = await outer.insert(schema.users).values({ email: `p53-existing-${suffix}@example.invalid`, emailVerifiedAt: verifiedAt }).returning();
    const [existingOrg] = await outer.insert(schema.organizations).values({ name: `P5.3 existing ${suffix}` }).returning();
    const [existingLocation] = await outer.insert(schema.locations).values({ organizationId: existingOrg.id, name: "Existing location", slug: `p53-existing-${suffix}`, timezone: "UTC" }).returning();
    await outer.insert(schema.organizationMembers).values({ organizationId: existingOrg.id, userId: existingUser.id, role: "owner" });
    const existingHash = createHash("sha256").update(`existing-invite-${suffix}`).digest("hex");
    const [existingIntent] = await outer.insert(schema.customerSignupIntents).values({
      email: existingUser.email, locale: "en", inviteTokenHash: existingHash,
      expiresAt: new Date(Date.now() + 60 * 60_000), verifiedAt,
    }).returning();
    await assert.rejects(completePartnerCustomerOnboarding({ ...input, authenticatedUserId: existingUser.id, signupIntentId: existingIntent.id }, { runInTransaction }), expectPartnerError("existing_organization"));
    assert.equal((await outer.select().from(schema.commercialPartnerInviteClaims).where(eq(schema.commercialPartnerInviteClaims.locationId, existingLocation.id))).length, 0);

    throw new Error("P53_ONBOARDING_TEST_ROLLBACK");
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== "P53_ONBOARDING_TEST_ROLLBACK") throw error;
  });
  console.info("V2 Partner Onboarding DB PASS: verified-user setup, single owner/location/claim, canonical Offer benefits/trial only, no independent Basic trial, retry idempotency, auth guards, existing-organization refusal, and claim-failure rollback. All fixtures rolled back.");
} finally {
  await v2Db.$client.end();
}
