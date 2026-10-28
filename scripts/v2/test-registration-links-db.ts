import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.V2_DATABASE_URL;
if (process.env.V2_REGISTRATION_LINK_TEST_ALLOW_DATABASE !== "1" || !databaseUrl) throw new Error("Refusing Registration Link integration test: explicit opt-in and a disposable local V2 database are required.");
const target = new URL(databaseUrl);
const role = decodeURIComponent(target.username);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname) || decodeURIComponent(target.pathname) !== "/soundspa_v2" || new Set(["soundspa_v2", "postgres", "root"]).has(role)) throw new Error("Refusing Registration Link integration test: only a dedicated loopback soundspa_v2 database role is allowed.");
process.env.V2_DATABASE_URL = databaseUrl;
process.env.V2_ADMIN_USERNAME = `registration-test-${randomUUID().slice(0, 8)}`;
process.env.V2_ADMIN_PASSWORD = `local-only-${randomUUID()}-operator-secret`;
process.env.V2_PUBLIC_ORIGIN = "https://test.soundspa.example";
const operatorAuthorization = `Basic ${Buffer.from(`${process.env.V2_ADMIN_USERNAME}:${process.env.V2_ADMIN_PASSWORD}`).toString("base64")}`;
async function main() {
const [{ v2Db, v2Pool }, schema, links, auth, { completeOrdinaryCustomerOnboarding }, { sha256 }, { startSoundSpaTrial }, { revokeProductPurchaseAuthorization }, { claimPartnerInvite }] = await Promise.all([
  import("../../db/v2/client"), import("../../db/v2/schema"), import("../../db/v2/services/registrationLinks"),
  import("../../db/v2/services/customerAuth"), import("../../db/v2/services/customerOnboarding"), import("../../lib/v2/customerAuthCore"),
  import("../../db/v2/queries/coreTrials"), import("../../db/v2/services/productVisibilityAdmin"), import("../../db/v2/services/partnerInviteClaims"),
]);
const identity = (await v2Pool.query<{ database: string; role: string; address: string | null; version: string; migrations: number; latest: string }>(`SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS address,current_setting('server_version_num') AS version,(SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS migrations,(SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest`)).rows[0];
const address = identity?.address?.split("/")[0] ?? "";
if (!identity || identity.database !== "soundspa_v2" || identity.role !== role || !identity.version.startsWith("16") || isIP(address) === 0 || !new Set(["127.0.0.1", "::1"]).has(address) || identity.migrations !== 28 || identity.latest !== "1793179822892") throw new Error("Refusing Registration Link integration test: expected isolated PostgreSQL 16 at migration 0027.");
const clean = await v2Pool.query<{ total: string }>(`SELECT
 (SELECT count(*) FROM organizations)+(SELECT count(*) FROM users)+(SELECT count(*) FROM locations)+
 (SELECT count(*) FROM commercial_products)+(SELECT count(*) FROM commercial_product_organization_authorizations)+
 (SELECT count(*) FROM commercial_registration_links)+(SELECT count(*) FROM commercial_registration_link_redemptions)+(SELECT count(*) FROM commercial_registration_link_grants)+
 (SELECT count(*) FROM commercial_billing_orders)+(SELECT count(*) FROM commercial_payments)+
 (SELECT count(*) FROM location_core_trials)+(SELECT count(*) FROM location_subscriptions)+
 (SELECT count(*) FROM commercial_partner_benefits)+(SELECT count(*) FROM location_channel_entitlements) AS total`);
if (clean.rows[0]?.total !== "0") throw new Error("Refusing Registration Link integration test: database must contain no application fixtures.");

const suffix = randomUUID();
const now = new Date();
const trialMs = 30 * 24 * 60 * 60 * 1000;
let assertions = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); assertions++; };
const rejectsCode = async (promise: Promise<unknown>, code: string) => {
  await assert.rejects(promise, (error: unknown) => error && typeof error === "object" && "code" in error && error.code === code);
  assertions++;
};
const assertUnavailableAtEndpoint = async (token: string, label: string) => {
  const { POST } = await import("../../app/api/v2/customer-auth/registration-link/start/route");
  const response = await POST(new Request("https://test.soundspa.example/api/v2/customer-auth/registration-link/start", {
    method: "POST", headers: { Origin: "https://test.soundspa.example", "Content-Type": "application/json" }, body: JSON.stringify({ token }),
  }));
  const body = await response.text();
  check(response.status === 400 && body === JSON.stringify({ ok: false, code: "registration_link_unavailable" }) &&
    !body.includes(token) && !response.headers.has("set-cookie"), `${label} link fails generically without exposing token material`);
};
async function startSignup(token: string, email: string, at = now) {
  const contextHash = sha256(randomUUID());
  const intent = await links.beginRegistrationLinkSignup(token, "en", contextHash, at);
  const issued = await auth.createSignupAuthRequest({ email, locale: "en", contextTokenHash: contextHash, now: at });
  assert(issued?.purpose === "verify_email");
  return { intentId: intent.id, email, authToken: issued.token };
}
async function verifySignup(pending: Awaited<ReturnType<typeof startSignup>>, at = now) {
  const consumed = await auth.consumeCustomerAuthToken(pending.authToken, at);
  assert(consumed?.sessionToken);
  assert.equal(await auth.consumeCustomerAuthToken(pending.authToken, at), null, "a verified email token cannot be replayed");
  assertions++;
  const session = await auth.getCustomerSession(consumed.sessionToken, at);
  assert(session?.session.signupIntentId === pending.intentId);
  return { intentId: pending.intentId, userId: session.user.id, email: pending.email, sessionToken: consumed.sessionToken };
}
async function newSignup(token: string, email: string, at = now) {
  return verifySignup(await startSignup(token, email, at), at);
}
function tokenFromLink(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("Registration Link fixture URL is missing its fragment token.");
  return token;
}

try {
  const [basic] = await v2Db.insert(schema.commercialProducts).values({ code: "soundspa", name: "SoundSpa Basic", kind: "core", isActive: true, visibility: "public" }).returning();
  const [divnitsa] = await v2Db.insert(schema.commercialProducts).values({ code: "divnitsa", name: "Divnitsa", kind: "partner", isActive: true, visibility: "private" }).returning();
  const [spaquatoria] = await v2Db.insert(schema.commercialProducts).values({ code: "spaquatoria", name: "Spaquatoria", kind: "partner", isActive: true, visibility: "private" }).returning();
  const [spaPartner, otherPartner] = await v2Db.insert(schema.commercialPartners).values([
    { code: "spaquatoria", name: "Spaquatoria", isActive: true },
    { code: `other-${suffix}`, name: "Other Partner", isActive: true },
  ]).returning();
  const maxLimited = await links.createRegistrationLink({ operator: process.env.V2_ADMIN_USERNAME, reason: "Disposable concurrent redemption limit test", expiresAt: new Date(now.getTime() + 3 * trialMs), maxRedemptions: 1, publicOrigin: "https://test.soundspa.example" });
  const token = tokenFromLink(maxLimited.url);
  const tokenHash = sha256(token);
  await assert.rejects(claimPartnerInvite({ token, locationId: randomUUID() }), (error: unknown) => error && typeof error === "object" && "code" in error && error.code === "INVITE_UNAVAILABLE");
  assertions++;
  const [storedLink] = await v2Db.select().from(schema.commercialRegistrationLinks).where(eq(schema.commercialRegistrationLinks.id, maxLimited.link.id));
  check(storedLink.tokenHash === tokenHash && !maxLimited.url.includes(storedLink.tokenHash), "only the SHA-256 token hash is stored");
  const listed = JSON.stringify(await links.listRegistrationLinks(now));
  check(!listed.includes(token) && !listed.includes(storedLink.tokenHash), "link listings never reveal token material");

  const first = await newSignup(token, `registration-first-${suffix}@example.invalid`);
  const second = await newSignup(token, `registration-second-${suffix}@example.invalid`);
  const complete = (input: typeof first, organizationName: string) => links.completeRegistrationLinkCustomerOnboarding({
    authenticatedUserId: input.userId, signupIntentId: input.intentId, organizationName, locationName: "First Location", timezone: "Europe/Moscow",
  }, now);
  const outcomes = await Promise.allSettled([complete(first, `Registration First ${suffix}`), complete(second, `Registration Second ${suffix}`)]);
  const successful = outcomes.filter((item) => item.status === "fulfilled" && item.value.status === "completed");
  const exhausted = outcomes.filter((item) => item.status === "rejected" && item.reason && typeof item.reason === "object" && "code" in item.reason && item.reason.code === "link_exhausted");
  check(successful.length === 1 && exhausted.length === 1, "a maximum-one link permits exactly one of two concurrent redemptions");
  const winnerIndex = outcomes.findIndex((item) => item.status === "fulfilled" && item.value.status === "completed");
  const winningUser = winnerIndex === 0 ? first : second;
  const winnerResult = outcomes[winnerIndex];
  if (winnerResult.status !== "fulfilled" || winnerResult.value.status !== "completed") throw new Error("A concurrent Registration Link redemption did not produce the expected completed onboarding.");
  const onboarding = winnerResult.value;
  await assertUnavailableAtEndpoint(token, "exhausted");
  check(onboarding.account.trial?.startsAt.getTime() === now.getTime(), "onboarding creates the Organization and first Location with the shared trial start");
  const organizationId = onboarding.account.organization!.id;
  const locationId = onboarding.account.location!.id;
  const [legacyOrganization] = await v2Db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  check(legacyOrganization.contactEmail === winningUser.email, "legacy Divnitsa Registration Link stores the verified owner email as Organization contact");
  const trials = await v2Db.select().from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, locationId));
  check(trials.length === 2, "the first Location receives exactly the Basic and Divnitsa trials");
  check(trials.every((trial) => trial.startsAt.getTime() === now.getTime() && trial.endsAt.getTime() === now.getTime() + trialMs), "both trials share exact 30 elapsed-day UTC boundaries");
  check(trials.some((trial) => trial.productId === basic.id) && trials.some((trial) => trial.productId === divnitsa.id), "the simultaneous trial set contains only the policy Products");
  const [membership] = await v2Db.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, winningUser.userId));
  check(membership?.organizationId === organizationId && membership.role === "owner", "verified registrant is Owner of the new Organization");
  const [grant] = await v2Db.select().from(schema.commercialProductOrganizationAuthorizations).where(eq(schema.commercialProductOrganizationAuthorizations.organizationId, organizationId));
  check(grant?.grantSource === "registration_link" && grant.grantedByOperator === null && grant.registrationRedemptionId !== null && grant.productId === divnitsa.id, "persistent private-product authorization uses truthful redemption provenance");
  const [redemption] = await v2Db.select().from(schema.commercialRegistrationLinkRedemptions).where(eq(schema.commercialRegistrationLinkRedemptions.id, grant!.registrationRedemptionId!));
  check(redemption?.verifiedUserId === winningUser.userId && redemption.organizationId === organizationId && redemption.firstLocationId === locationId, "redemption records link, verified user, Organization, and first Location");
  const [ownerless] = await v2Db.insert(schema.locations).values({ organizationId, name: "Second Location", slug: `registration-${suffix.slice(0, 12)}-second`, timezone: "Europe/Moscow" }).returning();
  check((await v2Db.select().from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, ownerless.id))).length === 0, "additional Locations receive no automatic trials");
  check((await v2Db.select().from(schema.commercialBillingOrders)).length === 0 && (await v2Db.select().from(schema.commercialPayments)).length === 0 && (await v2Db.select().from(schema.locationSubscriptions)).length === 0 && (await v2Db.select().from(schema.locationChannelEntitlements)).length === 0, "redemption creates no orders, payments, paid subscriptions, or playback entitlements");
  await v2Db.update(schema.organizations).set({ contactEmail: `operator-edited-${suffix}@example.invalid` }).where(eq(schema.organizations.id, organizationId));
  const repeated = await complete(winningUser, "Ignored repeated Organization");
  check(repeated.status === "already_complete" && repeated.organizationId === organizationId, "repeated onboarding returns the same completed redemption");
  const [legacyContactAfterRetry] = await v2Db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  check(legacyContactAfterRetry.contactEmail === `operator-edited-${suffix}@example.invalid`, "legacy replay preserves an operator-edited contact email");

  const [unverifiedRegistrationUser] = await v2Db.insert(schema.users).values({ email: `registration-unverified-${suffix}@example.invalid` }).returning();
  const [unverifiedRegistrationIntent] = await v2Db.insert(schema.customerSignupIntents).values({
    registrationLinkId: maxLimited.link.id, contextTokenHash: sha256(randomUUID()), email: unverifiedRegistrationUser.email,
    locale: "en", expiresAt: new Date(now.getTime() + 60_000),
  }).returning();
  await rejectsCode(links.completeRegistrationLinkCustomerOnboarding({ authenticatedUserId: unverifiedRegistrationUser.id, signupIntentId: unverifiedRegistrationIntent.id, organizationName: `Unverified ${suffix}`, locationName: "First Location", timezone: "UTC" }, now), "unverified");
  check((await v2Db.select().from(schema.organizations).where(eq(schema.organizations.name, `Unverified ${suffix}`))).length === 0, "unverified Registration Link user cannot create an Organization or contact email");

  const calendarNow = new Date("2024-01-31T12:34:56.789Z");
  const makeUniversal = async (selected: { productId: string; durationMonths: number }[], label: string, maxRedemptions?: number) => {
    const created = await links.createRegistrationLink({ operator: process.env.V2_ADMIN_USERNAME, reason: `Universal ${label} registration test`, products: selected, maxRedemptions, publicOrigin: "https://test.soundspa.example" });
    return { ...created, token: tokenFromLink(created.url) };
  };
  const finishUniversal = async (token: string, label: string) => {
    const pendingSignup = await newSignup(token, `universal-${label}-${suffix}@example.invalid`, calendarNow);
    const result = await links.completeRegistrationLinkCustomerOnboarding({ authenticatedUserId: pendingSignup.userId, signupIntentId: pendingSignup.intentId, organizationName: `Universal ${label} ${suffix}`, locationName: `${label} Location`, timezone: "UTC" }, calendarNow);
    if (result.status !== "completed") throw new Error(`Universal test redemption did not complete: ${label}`);
    return { pendingSignup, result };
  };
  const universalBasic = await makeUniversal([{ productId: basic.id, durationMonths: 1 }], "Basic only");
  const { pendingSignup: universalBasicSignup, result: universalBasicResult } = await finishUniversal(universalBasic.token, "basic");
  check(universalBasicResult.grants?.length === 1 && universalBasicResult.grants[0]?.productCode === "soundspa", "Basic-only universal link grants exactly Basic");
  const [universalBasicOrganization] = await v2Db.select().from(schema.organizations).where(eq(schema.organizations.id, universalBasicResult.account.organization!.id));
  check(universalBasicOrganization.contactEmail === universalBasicSignup.email, "universal Registration Link stores the verified owner email as Organization contact");
  const basicOnlyLocation = universalBasicResult.account.location!.id;
  const basicOnlyTrials = await v2Db.select().from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, basicOnlyLocation));
  check(basicOnlyTrials.length === 1 && basicOnlyTrials[0].productId === basic.id && basicOnlyTrials[0].endsAt.toISOString() === "2024-02-29T12:34:56.789Z", "Basic-only uses one UTC calendar month at a month-end boundary");
  check((await v2Db.select().from(schema.commercialProductOrganizationAuthorizations).where(eq(schema.commercialProductOrganizationAuthorizations.organizationId, universalBasicResult.account.organization!.id))).length === 0, "Basic-only does not grant private-product purchase authorization");
  await v2Db.update(schema.organizations).set({ contactEmail: `operator-universal-${suffix}@example.invalid` }).where(eq(schema.organizations.id, universalBasicResult.account.organization!.id));
  const universalBasicReplay = await links.completeRegistrationLinkCustomerOnboarding({ authenticatedUserId: universalBasicSignup.userId, signupIntentId: universalBasicSignup.intentId, organizationName: "Ignored replay", locationName: "Ignored", timezone: "UTC" }, calendarNow);
  const [universalBasicRedemption] = await v2Db.select().from(schema.commercialRegistrationLinkRedemptions).where(eq(schema.commercialRegistrationLinkRedemptions.signupIntentId, universalBasicSignup.intentId));
  check(universalBasicReplay.status === "already_complete" && (await v2Db.select().from(schema.commercialRegistrationLinkGrants).where(eq(schema.commercialRegistrationLinkGrants.redemptionId, universalBasicRedemption.id))).length === 1, "universal replay is idempotent and does not duplicate Product access");
  const [universalContactAfterRetry] = await v2Db.select().from(schema.organizations).where(eq(schema.organizations.id, universalBasicResult.account.organization!.id));
  check(universalContactAfterRetry.contactEmail === `operator-universal-${suffix}@example.invalid`, "universal replay preserves an operator-edited contact email");

  const universalMixed = await makeUniversal([{ productId: basic.id, durationMonths: 1 }, { productId: spaquatoria.id, durationMonths: 3 }], "Basic and Spaquatoria");
  const { result: mixedResult } = await finishUniversal(universalMixed.token, "basic-spaquatoria");
  check(mixedResult.grants?.length === 2, "Basic and Spaquatoria produce two independently tracked grants");
  const mixedLocation = mixedResult.account.location!.id;
  const mixedTrials = await v2Db.select().from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, mixedLocation));
  const mixedBenefits = await v2Db.select().from(schema.commercialPartnerBenefits).where(eq(schema.commercialPartnerBenefits.locationId, mixedLocation));
  check(mixedTrials.length === 1 && mixedTrials[0].productId === basic.id && mixedTrials[0].registrationLinkGrantId !== null, "mixed registration creates only the selected Basic trial with provenance");
  check(mixedBenefits.length === 1 && mixedBenefits[0].partnerId === spaPartner.id && mixedBenefits[0].productId === spaquatoria.id && mixedBenefits[0].endsAt?.toISOString() === "2024-04-30T12:34:56.789Z" && mixedBenefits[0].registrationLinkGrantId !== null, "Spaquatoria receives a separate three-calendar-month Partner Benefit");
  await assert.rejects(v2Db.insert(schema.commercialPartnerBenefits).values({
    partnerId: otherPartner.id, productId: spaquatoria.id, locationId: mixedLocation,
    startsAt: new Date("2024-01-31T12:34:56.789Z"), endsAt: new Date("2024-04-30T12:34:56.789Z"),
    registrationLinkGrantId: mixedBenefits[0].registrationLinkGrantId,
  }), (error: unknown) => {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
      if ("code" in current && current.code === "23503") return true;
      current = "cause" in current ? current.cause : null;
    }
    return false;
  });
  assertions++;
  check((await v2Db.select().from(schema.commercialProductOrganizationAuthorizations).where(eq(schema.commercialProductOrganizationAuthorizations.organizationId, mixedResult.account.organization!.id))).length === 0, "Basic plus Spaquatoria creates no Divnitsa purchase authorization");

  const universalBasicDiv = await makeUniversal([{ productId: basic.id, durationMonths: 1 }, { productId: divnitsa.id, durationMonths: 2 }], "Basic and Divnitsa");
  const { result: basicDivResult } = await finishUniversal(universalBasicDiv.token, "basic-divnitsa");
  const basicDivLocation = basicDivResult.account.location!.id;
  const basicDivTrials = await v2Db.select().from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, basicDivLocation));
  check(basicDivResult.grants?.length === 2 && basicDivTrials.length === 2 && basicDivTrials.every((trial) => trial.registrationLinkGrantId !== null), "Basic plus Divnitsa creates exactly two sourced trial rows");
  check(basicDivTrials.find((trial) => trial.productId === basic.id)?.endsAt.toISOString() === "2024-02-29T12:34:56.789Z" && basicDivTrials.find((trial) => trial.productId === divnitsa.id)?.endsAt.toISOString() === "2024-03-31T12:34:56.789Z", "Basic and Divnitsa retain independent UTC calendar-month durations");
  const [universalDivAuth] = await v2Db.select().from(schema.commercialProductOrganizationAuthorizations).where(eq(schema.commercialProductOrganizationAuthorizations.organizationId, basicDivResult.account.organization!.id));
  check(universalDivAuth?.productId === divnitsa.id && universalDivAuth.grantSource === "registration_link" && universalDivAuth.grantedByOperator === null, "only selected Divnitsa receives persistent private-product authorization");
  check((await v2Db.select().from(schema.commercialPartnerBenefits).where(eq(schema.commercialPartnerBenefits.locationId, basicDivLocation))).length === 0, "Basic plus Divnitsa creates no Spaquatoria benefit");

  const universalSpaOnly = await makeUniversal([{ productId: spaquatoria.id, durationMonths: 1 }], "Spaquatoria only");
  const { result: spaOnlyResult } = await finishUniversal(universalSpaOnly.token, "spaquatoria-only");
  const spaOnlyLocation = spaOnlyResult.account.location!.id;
  check(spaOnlyResult.grants?.length === 1 && (await v2Db.select().from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, spaOnlyLocation))).length === 0, "Spaquatoria-only registration receives no automatic Basic or Divnitsa trial");
  check((await v2Db.select().from(schema.commercialProductOrganizationAuthorizations).where(eq(schema.commercialProductOrganizationAuthorizations.organizationId, spaOnlyResult.account.organization!.id))).length === 0, "Spaquatoria-only registration creates no private-product authorization");

  const universalDivOnly = await makeUniversal([{ productId: divnitsa.id, durationMonths: 1 }], "Divnitsa only");
  const { result: divOnlyResult } = await finishUniversal(universalDivOnly.token, "divnitsa-only");
  const divOnlyLocation = divOnlyResult.account.location!.id;
  const divOnlyTrials = await v2Db.select().from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, divOnlyLocation));
  check(divOnlyResult.grants?.length === 1 && divOnlyTrials.length === 1 && divOnlyTrials[0].productId === divnitsa.id, "Divnitsa-only registration does not add an unselected Basic trial");
  const [divOnlyAuth] = await v2Db.select().from(schema.commercialProductOrganizationAuthorizations).where(eq(schema.commercialProductOrganizationAuthorizations.organizationId, divOnlyResult.account.organization!.id));
  check(divOnlyAuth?.productId === divnitsa.id && divOnlyAuth.grantSource === "registration_link", "Divnitsa-only registration gets its required persistent purchase authorization");

  check((await v2Db.select().from(schema.commercialBillingOrders)).length === 0 && (await v2Db.select().from(schema.commercialPayments)).length === 0 && (await v2Db.select().from(schema.locationSubscriptions)).length === 0 && (await v2Db.select().from(schema.locationChannelEntitlements)).length === 0, "universal registrations create no orders, payments, subscriptions, or paid entitlement records");

  const universalLimited = await makeUniversal([{ productId: basic.id, durationMonths: 1 }], "concurrency", 1);
  const concurrentUniversalUsers = await Promise.all([
    newSignup(universalLimited.token, `universal-concurrent-a-${suffix}@example.invalid`),
    newSignup(universalLimited.token, `universal-concurrent-b-${suffix}@example.invalid`),
  ]);
  const concurrentUniversal = await Promise.allSettled(concurrentUniversalUsers.map((input, index) => links.completeRegistrationLinkCustomerOnboarding({ authenticatedUserId: input.userId, signupIntentId: input.intentId, organizationName: `Universal concurrent ${index} ${suffix}`, locationName: "Concurrent", timezone: "UTC" }, now)));
  check(concurrentUniversal.filter((item) => item.status === "fulfilled" && item.value.status === "completed").length === 1 && concurrentUniversal.filter((item) => item.status === "rejected" && item.reason && typeof item.reason === "object" && "code" in item.reason && item.reason.code === "link_exhausted").length === 1, "universal link row locking enforces a one-redemption limit under concurrency");

  const disableTest = await links.createRegistrationLink({ operator: process.env.V2_ADMIN_USERNAME, reason: "Disposable disable before redemption", publicOrigin: "https://test.soundspa.example" });
  const disableToken = tokenFromLink(disableTest.url);
  const pendingEmail = `registration-disabled-${suffix}@example.invalid`;
  const pending = await startSignup(disableToken, pendingEmail);
  await links.disableRegistrationLink(disableTest.link.id, { operator: process.env.V2_ADMIN_USERNAME, reason: "Disable before future redemption test" });
  await rejectsCode(links.beginRegistrationLinkSignup(disableToken, "en", sha256(randomUUID()), now), "link_unavailable");
  await assertUnavailableAtEndpoint(disableToken, "revoked");
  const pendingVerified = await verifySignup(pending);
  await rejectsCode(links.completeRegistrationLinkCustomerOnboarding({ authenticatedUserId: pendingVerified.userId, signupIntentId: pendingVerified.intentId, organizationName: `Disabled ${suffix}`, locationName: "First Location", timezone: "UTC" }, now), "link_unavailable");
  const [disabledMembership] = await v2Db.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, pendingVerified.userId));
  check(!disabledMembership, "a link disabled while email verification is pending cannot create a customer Organization");
  const [stillActive] = await v2Db.select().from(schema.commercialProductOrganizationAuthorizations).where(eq(schema.commercialProductOrganizationAuthorizations.id, grant!.id));
  check(stillActive?.revokedAt === null, "disabling a Registration Link does not revoke already redeemed purchase authorization");
  await revokeProductPurchaseAuthorization({ productId: divnitsa.id, authorizationId: grant!.id, reason: "Disposable operator revocation test", confirmed: true, operatorAuthorization });
  const [revoked] = await v2Db.select().from(schema.commercialProductOrganizationAuthorizations).where(eq(schema.commercialProductOrganizationAuthorizations.id, grant!.id));
  check(revoked?.grantSource === "registration_link" && revoked.registrationRedemptionId === redemption!.id && revoked.grantedByOperator === null && revoked.revokedByOperator === process.env.V2_ADMIN_USERNAME, "existing operator revocation preserves truthful source and redemption history");

  const rollbackLink = await links.createRegistrationLink({ operator: process.env.V2_ADMIN_USERNAME, reason: "Disposable transaction rollback validation", publicOrigin: "https://test.soundspa.example" });
  const rollbackToken = tokenFromLink(rollbackLink.url);
  const rollbackUser = await newSignup(rollbackToken, `registration-rollback-${suffix}@example.invalid`);
  const rollbackOrganizationName = `Must Roll Back ${suffix}`;
  await v2Pool.query(`CREATE FUNCTION registration_link_test_reject_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced integration rollback'; END; $$`);
  await v2Pool.query(`CREATE TRIGGER registration_link_test_reject_grant BEFORE INSERT ON commercial_product_organization_authorizations FOR EACH ROW WHEN (NEW.grant_source = 'registration_link') EXECUTE FUNCTION registration_link_test_reject_grant()`);
  await rejectsCode(links.completeRegistrationLinkCustomerOnboarding({ authenticatedUserId: rollbackUser.userId, signupIntentId: rollbackUser.intentId, organizationName: rollbackOrganizationName, locationName: "First Location", timezone: "UTC" }, now), "onboarding_failed");
  await v2Pool.query("DROP TRIGGER registration_link_test_reject_grant ON commercial_product_organization_authorizations");
  await v2Pool.query("DROP FUNCTION registration_link_test_reject_grant()");
  check((await v2Db.select().from(schema.organizations).where(eq(schema.organizations.name, rollbackOrganizationName))).length === 0, "grant insertion failure rolls back Organization and Location creation");
  check((await v2Db.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, rollbackUser.userId))).length === 0, "grant insertion failure rolls back Owner membership");
  check((await v2Db.select().from(schema.commercialRegistrationLinkRedemptions).where(eq(schema.commercialRegistrationLinkRedemptions.signupIntentId, rollbackUser.intentId))).length === 0, "grant insertion failure rolls back redemption history");
  const rolledBackTrials = await v2Pool.query<{ count: string }>("SELECT count(*)::text AS count FROM location_core_trials t JOIN locations l ON l.id=t.location_id JOIN organizations o ON o.id=l.organization_id WHERE o.name=$1", [rollbackOrganizationName]);
  check(rolledBackTrials.rows[0]?.count === "0", "grant insertion failure rolls back both policy trial rows");

  const { newOpaqueToken } = await import("../../lib/v2/customerAuthCore");
  const expiredToken = newOpaqueToken();
  const expiredCreatedAt = new Date(Date.now() - 2 * trialMs);
  const expiredAt = new Date(Date.now() - trialMs);
  await v2Db.insert(schema.commercialRegistrationLinks).values({
    tokenHash: sha256(expiredToken), policyKey: "divnitsa", policyVersion: 1,
    policySnapshot: { policyKey: "divnitsa", policyVersion: 1, basicProductId: basic.id, divnitsaProductId: divnitsa.id, basicTrialDays: 30, divnitsaTrialDays: 30 },
    createdByOperator: process.env.V2_ADMIN_USERNAME!, creationReason: "Disposable expired API fixture",
    createdAt: expiredCreatedAt, expiresAt: expiredAt,
  });
  await rejectsCode(links.beginRegistrationLinkSignup(expiredToken, "en", sha256(randomUUID()), new Date(Date.now() + 120_000)), "link_unavailable");
  await assertUnavailableAtEndpoint(expiredToken, "expired");

  const existingLink = await links.createRegistrationLink({ operator: process.env.V2_ADMIN_USERNAME, reason: "Disposable existing Organization rejection test", publicOrigin: "https://test.soundspa.example" });
  const existingToken = tokenFromLink(existingLink.url);
  const existingEmail = `registration-existing-${suffix}@example.invalid`;
  const existingContextHash = sha256(randomUUID());
  const existingIntent = await links.beginRegistrationLinkSignup(existingToken, "en", existingContextHash, now);
  const [existingUser] = await v2Db.insert(schema.users).values({ email: existingEmail, emailVerifiedAt: now }).returning();
  const existingAuth = await auth.createSignupAuthRequest({ email: existingEmail, locale: "en", contextTokenHash: existingContextHash, now });
  check(existingAuth?.purpose === "login_link", "a previously verified user receives the established login-link flow");
  const existingSession = await auth.consumeCustomerAuthToken(existingAuth!.token, now);
  const [existingOrganization] = await v2Db.insert(schema.organizations).values({ name: `Existing ${suffix}` }).returning();
  const [existingLocation] = await v2Db.insert(schema.locations).values({ organizationId: existingOrganization.id, name: "Existing Location", slug: `existing-${suffix.slice(0, 12)}`, timezone: "UTC" }).returning();
  await v2Db.insert(schema.organizationMembers).values({ organizationId: existingOrganization.id, userId: existingUser.id, role: "owner" });
  await rejectsCode(links.completeRegistrationLinkCustomerOnboarding({ authenticatedUserId: existingUser.id, signupIntentId: existingIntent.id, organizationName: `Must Not Create ${suffix}`, locationName: "First Location", timezone: "UTC" }, now), "existing_organization");
  check((await v2Db.select().from(schema.commercialRegistrationLinkRedemptions).where(eq(schema.commercialRegistrationLinkRedemptions.signupIntentId, existingIntent.id))).length === 0, "an existing Organization cannot redeem a new-Organization Registration Link");
  check(existingSession?.user.id === existingUser.id && existingLocation.organizationId === existingOrganization.id, "existing customer login and tenant ownership remain intact");

  const [ordinaryUser] = await v2Db.insert(schema.users).values({ email: `ordinary-${suffix}@example.invalid`, emailVerifiedAt: now }).returning();
  const [ordinaryIntent] = await v2Db.insert(schema.customerSignupIntents).values({ email: ordinaryUser.email, locale: "en", expiresAt: new Date(now.getTime() + 60_000), verifiedAt: now }).returning();
  const ordinary = await completeOrdinaryCustomerOnboarding({ authenticatedUserId: ordinaryUser.id, signupIntentId: ordinaryIntent.id, organizationName: `Ordinary ${suffix}`, locationName: "First Location", timezone: "UTC" }, { createTrial: (locationId, db) => startSoundSpaTrial(locationId, db) });
  check(ordinary.status === "completed" && ordinary.account.trial!.endsAt.getTime() - ordinary.account.trial!.startsAt.getTime() === 28 * 24 * 60 * 60 * 1000, "ordinary signup retains the existing 28-day Basic trial");
  const [ordinaryOrganization] = await v2Db.select().from(schema.organizations).where(eq(schema.organizations.id, ordinary.account.organization!.id));
  check(ordinaryOrganization.contactEmail === ordinaryUser.email, "ordinary registration stores verified user email as Organization contact");

  console.info(`V2 Registration Link DB PASS: ${assertions} assertions across concurrent redemption limits, exact dual trials, authorization provenance/revocation, link disable/expiry, idempotency, no billing side effects, and ordinary signup regression. Fixtures retained only in this disposable database.`);
} finally {
  await v2Pool.end();
}
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
