import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import { sha256 } from "../../lib/v2/customerAuthCore";
import { customerAuthTokens, customerSessions, customerSignupIntents, organizationMembers, users } from "../../db/v2/schema";

if (!process.env.V2_DATABASE_URL) throw new Error("Set V2_DATABASE_URL to a dedicated non-production V2 test database.");
if (process.env.CUSTOMER_AUTH_TEST_ALLOW_MUTATION !== "1") throw new Error("Set CUSTOMER_AUTH_TEST_ALLOW_MUTATION=1 to run rollback-cleaned auth integration checks.");
if (process.env.NODE_ENV === "production") throw new Error("Refusing customer-auth integration test in production mode.");

const suffix = randomUUID();
const email = `p51-auth-${suffix}@example.invalid`;
const ordinaryEmail = `p51-ordinary-${suffix}@example.invalid`;
const inviteToken = randomBytes(32).toString("base64url");
const contextToken = randomBytes(32).toString("base64url");
const inviteHash = sha256(inviteToken);
const contextHash = sha256(contextToken);
const now = new Date();

async function main() {
  const { v2Db } = await import("../../db/v2/client");
  const service = await import("../../db/v2/services/customerAuth");
  let intentId: string | null = null;
  try {
    const [intent] = await v2Db.insert(customerSignupIntents).values({
      inviteTokenHash: inviteHash, contextTokenHash: contextHash, locale: "vi",
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    }).returning();
    intentId = intent.id;
    assert.equal(intent.inviteTokenHash, inviteHash);
    assert.equal(JSON.stringify(intent).includes(inviteToken), false, "plaintext Invite token must not persist in intent");

    const expired = await service.createSignupAuthRequest({ email, locale: "vi", contextTokenHash: contextHash, now });
    assert.ok(expired);
    const [storedExpired] = await v2Db.select().from(customerAuthTokens).where(eq(customerAuthTokens.tokenHash, sha256(expired.token)));
    assert.equal(storedExpired.tokenHash, sha256(expired.token));
    assert.equal(JSON.stringify(storedExpired).includes(expired.token), false);
    await v2Db.update(customerAuthTokens).set({ expiresAt: new Date(now.getTime() - 1) }).where(eq(customerAuthTokens.id, storedExpired.id));
    assert.equal(await service.consumeCustomerAuthToken(expired.token, now), null, "expired token must not consume");

    const verification = await service.createSignupAuthRequest({ email, locale: "vi", contextTokenHash: contextHash, now });
    assert.ok(verification);
    const consumed = await service.consumeCustomerAuthToken(verification.token, now);
    assert.ok(consumed?.user);
    assert.equal(consumed.user.email, email);
    assert.equal(consumed.user.preferredLocale, "vi");
    assert.ok(consumed.user.emailVerifiedAt);
    assert.equal(await service.consumeCustomerAuthToken(verification.token, now), null, "consumed token replay must fail");
    assert.equal((await v2Db.select().from(organizationMembers).where(eq(organizationMembers.userId, consumed.user.id))).length, 0, "P5.1 must not create owner membership");
    const [verifiedPartnerIntent] = await v2Db.select().from(customerSignupIntents).where(eq(customerSignupIntents.id, intentId!));
    assert.equal(verifiedPartnerIntent.completedAt, null, "Partner context remains pending after email verification.");
    // Existing intents created before P5.3 may have the P5.1 verification
    // timestamp in completed_at; equality remains a pending Partner marker.
    await v2Db.update(customerSignupIntents).set({ completedAt: now }).where(eq(customerSignupIntents.id, intentId!));

    const partnerLogin = await service.createSignupAuthRequest({ email, locale: "ru", contextTokenHash: contextHash, now });
    assert.equal(partnerLogin?.purpose, "login_link", "An existing verified user entering through a Partner link receives the normal login email purpose.");
    const partnerLoginSession = await service.consumeCustomerAuthToken(partnerLogin!.token, now);
    assert.equal(partnerLoginSession?.user.id, consumed.user.id, "Existing verified Partner user must reuse the same identity.");
    const [linkedSession] = await v2Db.select().from(customerSessions).where(eq(customerSessions.tokenHash, sha256(partnerLoginSession!.sessionToken)));
    assert.equal(linkedSession.signupIntentId, intentId, "The authenticated Partner context remains attached server-side to the session.");
    const expiredIntentLogin = await service.createSignupAuthRequest({ email, locale: "en", contextTokenHash: contextHash, now });
    assert.equal(expiredIntentLogin?.purpose, "login_link");
    await v2Db.update(customerSignupIntents).set({ expiresAt: new Date(now.getTime() - 1) }).where(eq(customerSignupIntents.id, intentId!));
    assert.equal(await service.consumeCustomerAuthToken(expiredIntentLogin!.token, now), null, "An expired Partner signup intent must not be restored through a login link.");
    await v2Db.update(customerSignupIntents).set({ expiresAt: new Date(now.getTime() + 60_000) }).where(eq(customerSignupIntents.id, intentId!));

    const ordinary = await service.createSignupAuthRequest({ email: ordinaryEmail, locale: "en", contextTokenHash: null, now });
    assert.ok(ordinary);
    const [ordinaryToken] = await v2Db.select().from(customerAuthTokens).where(eq(customerAuthTokens.tokenHash, sha256(ordinary.token)));
    const [ordinaryIntent] = await v2Db.select().from(customerSignupIntents).where(eq(customerSignupIntents.id, ordinaryToken.signupIntentId!));
    assert.equal(ordinaryIntent.inviteTokenHash, null, "ordinary signup has no Invite context");
    const ordinaryResult = await service.consumeCustomerAuthToken(ordinary.token, now);
    assert.ok(ordinaryResult?.user);
    assert.equal((await v2Db.select().from(organizationMembers).where(eq(organizationMembers.userId, ordinaryResult.user.id))).length, 0);

    const sessionHash = sha256(consumed.sessionToken);
    const [storedSession] = await v2Db.select().from(customerSessions).where(eq(customerSessions.tokenHash, sessionHash));
    assert.ok(storedSession);
    assert.equal(storedSession.tokenHash, sessionHash);
    assert.equal(JSON.stringify(storedSession).includes(consumed.sessionToken), false);
    assert.ok(await service.getCustomerSession(consumed.sessionToken, now));
    await v2Db.update(customerSessions).set({ expiresAt: new Date(now.getTime() - 1) }).where(eq(customerSessions.id, storedSession.id));
    assert.equal(await service.getCustomerSession(consumed.sessionToken, now), null, "expired session must be rejected");

    const login = await service.createLoginAuthRequest({ email, locale: "ru", now });
    assert.ok(login);
    const loginSession = await service.consumeCustomerAuthToken(login.token, now);
    assert.ok(loginSession?.user);
    assert.equal(loginSession.user.preferredLocale, "ru");
    assert.ok(await service.getCustomerSession(loginSession.sessionToken, now));
    await service.revokeCustomerSession(loginSession.sessionToken, now);
    assert.equal(await service.getCustomerSession(loginSession.sessionToken, now), null, "logout revocation must invalidate session");
    console.info("Customer auth DB integration scenarios passed; fixtures will be removed in finally.");
  } finally {
    const intentFilters = [eq(customerSignupIntents.email, email), eq(customerSignupIntents.email, ordinaryEmail)];
    if (intentId) intentFilters.push(eq(customerSignupIntents.id, intentId));
    const intents = await v2Db.select({ id: customerSignupIntents.id }).from(customerSignupIntents).where(or(...intentFilters));
    const intentIds = intents.map((row) => row.id);
    const fixtureUsers = await v2Db.select({ id: users.id }).from(users).where(inArray(users.email, [email, ordinaryEmail]));
    const userIds = fixtureUsers.map((row) => row.id);
    if (userIds.length) await v2Db.delete(customerSessions).where(inArray(customerSessions.userId, userIds));
    const tokenFilters = [
      ...(intentIds.length ? [inArray(customerAuthTokens.signupIntentId, intentIds)] : []),
      ...(userIds.length ? [inArray(customerAuthTokens.userId, userIds)] : []),
    ];
    if (tokenFilters.length) await v2Db.delete(customerAuthTokens).where(or(...tokenFilters));
    if (intentIds.length) await v2Db.delete(customerSignupIntents).where(inArray(customerSignupIntents.id, intentIds));
    if (userIds.length) await v2Db.delete(users).where(inArray(users.id, userIds));
    const { v2Pool } = await import("../../db/v2/client");
    await v2Pool.end();
  }
}

main().catch((error) => {
  // Never print generated credentials or Invite/auth token material.
  console.error(error instanceof Error ? error.message : "Customer auth integration failed");
  process.exitCode = 1;
});
