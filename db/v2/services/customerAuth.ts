import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { v2Db } from "../client";
import { customerAuthTokens, customerSessions, customerSignupIntents, users } from "../schema";
import {
  AUTH_TOKEN_TTL_MS, CUSTOMER_SESSION_TTL_MS, SIGNUP_INTENT_TTL_MS,
  newHashedOpaqueToken, sha256,
} from "@/lib/v2/customerAuthCore";

type Locale = "en" | "ru" | "vi" | "th";
type AuthPurpose = "verify_email" | "login_link";

export async function createSignupAuthRequest(input: { email: string; locale: Locale; contextTokenHash: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  const existing = await v2Db.select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
    .from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
  if (existing[0]?.disabledAt || existing[0]?.emailVerifiedAt || input.contextTokenHash === "invalid") return null;

  let intentId: string;
  if (input.contextTokenHash) {
    const [intent] = await v2Db.update(customerSignupIntents).set({ email: input.email, locale: input.locale, updatedAt: now }).where(and(
      eq(customerSignupIntents.contextTokenHash, input.contextTokenHash),
      gt(customerSignupIntents.expiresAt, now), isNull(customerSignupIntents.completedAt),
      or(isNull(customerSignupIntents.email), eq(customerSignupIntents.email, input.email)),
    )).returning({ id: customerSignupIntents.id });
    if (!intent) return null;
    intentId = intent.id;
  } else {
    const [intent] = await v2Db.insert(customerSignupIntents).values({
      email: input.email, locale: input.locale, expiresAt: new Date(now.getTime() + SIGNUP_INTENT_TTL_MS),
    }).returning({ id: customerSignupIntents.id });
    intentId = intent.id;
  }
  return createAuthToken("verify_email", input.locale, { signupIntentId: intentId }, now);
}

export async function createLoginAuthRequest(input: { email: string; locale: Locale; now?: Date }) {
  const now = input.now ?? new Date();
  const [user] = await v2Db.select({ id: users.id, disabledAt: users.disabledAt, emailVerifiedAt: users.emailVerifiedAt })
    .from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
  if (!user || !user.emailVerifiedAt || user.disabledAt) return null;
  return createAuthToken("login_link", input.locale, { userId: user.id }, now);
}

async function createAuthToken(purpose: AuthPurpose, locale: Locale, target: { userId?: string; signupIntentId?: string }, now: Date) {
  const { token, tokenHash } = newHashedOpaqueToken();
  await v2Db.insert(customerAuthTokens).values({
    tokenHash, purpose, locale, userId: target.userId, signupIntentId: target.signupIntentId,
    expiresAt: new Date(now.getTime() + AUTH_TOKEN_TTL_MS),
  });
  return { token, purpose };
}

export async function consumeCustomerAuthToken(token: string, now = new Date()) {
  const tokenHash = sha256(token);
  try {
    return await v2Db.transaction(async (tx) => {
      const [authToken] = await tx.select().from(customerAuthTokens).where(and(
        eq(customerAuthTokens.tokenHash, tokenHash), isNull(customerAuthTokens.consumedAt), gt(customerAuthTokens.expiresAt, now),
      )).limit(1);
      if (!authToken) return null;

      let userId = authToken.userId;
      if (authToken.purpose === "verify_email") {
        if (!authToken.signupIntentId) return null;
        const [intent] = await tx.select().from(customerSignupIntents).where(and(
          eq(customerSignupIntents.id, authToken.signupIntentId), gt(customerSignupIntents.expiresAt, now),
          isNull(customerSignupIntents.completedAt),
        )).limit(1).for("update");
        if (!intent?.email) return null;
        const [existing] = await tx.select().from(users).where(sql`lower(${users.email}) = ${intent.email}`).limit(1).for("update");
        if (existing?.disabledAt) return null;
        if (existing && existing.emailVerifiedAt) return null;
        if (existing) {
          userId = existing.id;
          await tx.update(users).set({ emailVerifiedAt: now, preferredLocale: intent.locale, updatedAt: now }).where(eq(users.id, existing.id));
        } else {
          const [inserted] = await tx.insert(users).values({ email: intent.email, emailVerifiedAt: now, preferredLocale: intent.locale })
            .onConflictDoNothing().returning({ id: users.id });
          if (inserted) userId = inserted.id;
          else {
            const [racedUser] = await tx.select().from(users).where(sql`lower(${users.email}) = ${intent.email}`).limit(1).for("update");
            if (!racedUser || racedUser.disabledAt || racedUser.emailVerifiedAt) return null;
            userId = racedUser.id;
            await tx.update(users).set({ emailVerifiedAt: now, preferredLocale: intent.locale, updatedAt: now }).where(eq(users.id, racedUser.id));
          }
        }
        await tx.update(customerSignupIntents).set({ verifiedAt: now, completedAt: now, updatedAt: now })
          .where(eq(customerSignupIntents.id, intent.id));
      } else if (authToken.purpose === "login_link" && userId) {
        const [user] = await tx.select({ disabledAt: users.disabledAt, emailVerifiedAt: users.emailVerifiedAt })
          .from(users).where(eq(users.id, userId)).limit(1);
        if (!user || user.disabledAt || !user.emailVerifiedAt) return null;
        await tx.update(users).set({ preferredLocale: authToken.locale, updatedAt: now }).where(eq(users.id, userId));
      } else return null;

      if (!userId) return null;
      const [consumed] = await tx.update(customerAuthTokens).set({ consumedAt: now }).where(and(
        eq(customerAuthTokens.id, authToken.id), isNull(customerAuthTokens.consumedAt), gt(customerAuthTokens.expiresAt, now),
      )).returning({ id: customerAuthTokens.id });
      if (!consumed) throw new Error("AUTH_TOKEN_RACE");

      const { token: sessionToken, tokenHash: sessionTokenHash } = newHashedOpaqueToken();
      await tx.insert(customerSessions).values({ userId, signupIntentId: authToken.signupIntentId, tokenHash: sessionTokenHash, expiresAt: new Date(now.getTime() + CUSTOMER_SESSION_TTL_MS) });
      const [user] = await tx.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, preferredLocale: users.preferredLocale })
        .from(users).where(eq(users.id, userId)).limit(1);
      return { sessionToken, user };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_TOKEN_RACE") return null;
    throw error;
  }
}

export async function getCustomerSession(sessionToken: string, now = new Date()) {
  const [row] = await v2Db.select({ session: customerSessions, user: users })
    .from(customerSessions).innerJoin(users, eq(customerSessions.userId, users.id))
    .where(and(eq(customerSessions.tokenHash, sha256(sessionToken)), isNull(customerSessions.revokedAt), gt(customerSessions.expiresAt, now), isNull(users.disabledAt)))
    .limit(1);
  return row ?? null;
}

export async function revokeCustomerSession(sessionToken: string, now = new Date()) {
  await v2Db.update(customerSessions).set({ revokedAt: now }).where(and(
    eq(customerSessions.tokenHash, sha256(sessionToken)), isNull(customerSessions.revokedAt),
  ));
}
