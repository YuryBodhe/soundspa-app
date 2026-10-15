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
if (!identity || identity.database !== "soundspa_v2" || identity.role !== role || !identity.version.startsWith("16") || isIP(address) === 0 || !new Set(["127.0.0.1", "::1"]).has(address) || identity.migrations !== 23 || identity.latest !== "1792025178280") throw new Error("Refusing Registration Link integration test: expected isolated PostgreSQL 16 at migration 0022.");
const clean = await v2Pool.query<{ total: string }>(`SELECT
 (SELECT count(*) FROM organizations)+(SELECT count(*) FROM users)+(SELECT count(*) FROM locations)+
 (SELECT count(*) FROM commercial_products)+(SELECT count(*) FROM commercial_product_organization_authorizations)+
 (SELECT count(*) FROM commercial_registration_links)+(SELECT count(*) FROM commercial_registration_link_redemptions)+
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
async function startSignup(token: string, email: string) {
  const contextHash = sha256(randomUUID());
  const intent = await links.beginRegistrationLinkSignup(token, "en", contextHash, now);
  const issued = await auth.createSignupAuthRequest({ email, locale: "en", contextTokenHash: contextHash, now });
  assert(issued?.purpose === "verify_email");
  return { intentId: intent.id, email, authToken: issued.token };
}
async function verifySignup(pending: Awaited<ReturnType<typeof startSignup>>) {
  const consumed = await auth.consumeCustomerAuthToken(pending.authToken, now);
  assert(consumed?.sessionToken);
  assert.equal(await auth.consumeCustomerAuthToken(pending.authToken, now), null, "a verified email token cannot be replayed");
  assertions++;
  const session = await auth.getCustomerSession(consumed.sessionToken, now);
  assert(session?.session.signupIntentId === pending.intentId);
  return { intentId: pending.intentId, userId: session.user.id, email: pending.email, sessionToken: consumed.sessionToken };
}
async function newSignup(token: string, email: string) {
  return verifySignup(await startSignup(token, email));
}
function tokenFromLink(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
  if (!token) throw new Error("Registration Link fixture URL is missing its fragment token.");
  return token;
}

try {
  const [basic] = await v2Db.insert(schema.commercialProducts).values({ code: "soundspa", name: "SoundSpa Basic", kind: "core", isActive: true, visibility: "public" }).returning();
  const [divnitsa] = await v2Db.insert(schema.commercialProducts).values({ code: "divnitsa", name: "Divnitsa", kind: "partner", isActive: true, visibility: "private" }).returning();
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
  const repeated = await complete(winningUser, "Ignored repeated Organization");
  check(repeated.status === "already_complete" && repeated.organizationId === organizationId, "repeated onboarding returns the same completed redemption");

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

  console.info(`V2 Registration Link DB PASS: ${assertions} assertions across concurrent redemption limits, exact dual trials, authorization provenance/revocation, link disable/expiry, idempotency, no billing side effects, and ordinary signup regression. Fixtures retained only in this disposable database.`);
} finally {
  await v2Pool.end();
}
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
