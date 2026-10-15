import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialProductOrganizationAuthorizations, commercialProducts,
  commercialRegistrationLinkEvents, commercialRegistrationLinkRedemptions,
  commercialRegistrationLinkGrants, commercialRegistrationLinks, commercialPartners, commercialPartnerBenefits,
  customerSignupIntents, locationCoreTrials, locations, organizationMembers, organizations, users,
} from "../schema";
import { soundSpaBasicTrialEndsAt } from "../queries/trialPolicy";
import { SOUNDSPA_PRODUCT_CODE } from "../queries/commercialProducts";
import { createLocationSlug } from "@/lib/v2/customerOnboarding";
import { SIGNUP_INTENT_TTL_MS, newOpaqueToken, sha256 } from "@/lib/v2/customerAuthCore";
import { createCustomerWithFirstLocationInTransaction, validateCustomerProvisioningInput } from "./customerProvisioning";
import { startSoundSpaTrial } from "../queries/coreTrials";
import { getRegistrationLinkLifecycleStatus } from "./registrationLinkModel";
import { buildRegistrationLinkUrl } from "@/lib/v2/registrationLinkUrl";
import { addBillingCalendarMonths, billingAnchorForDate } from "./billingCalendar";
import type { UniversalRegistrationLinkProduct } from "../schema/core/customerAuth";

const DIVNITSA_PRODUCT_CODE = "divnitsa";
const POLICY_VERSION = 1 as const;
const POLICY_DAYS = 30 as const;
const UNIVERSAL_POLICY_VERSION = 1 as const;
const SPAQUATORIA_PRODUCT_CODE = "spaquatoria";
const SPAQUATORIA_PARTNER_CODE = "spaquatoria";
const nonempty = (value: unknown, max: number, min = 1) => typeof value === "string" && value.trim().length >= min && value.trim().length <= max ? value.trim() : null;
const pgCode = (error: unknown) => {
  let value: unknown = error;
  for (let i = 0; i < 4 && value && typeof value === "object"; i++) {
    const item = value as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string") return item.code;
    value = item.cause;
  }
  return undefined;
};

export type RegistrationLinkErrorCode = "invalid" | "not_found" | "already_disabled" | "operator_unavailable" | "unavailable" | "unauthenticated" | "unverified" | "existing_organization" | "signup_context" | "link_unavailable" | "link_exhausted" | "ambiguous" | "onboarding_failed";
export class RegistrationLinkError extends Error {
  constructor(readonly code: RegistrationLinkErrorCode) { super(code); this.name = "RegistrationLinkError"; }
}

function operatorIdentity(explicit?: string) {
  const configured = process.env.V2_ADMIN_USERNAME?.trim();
  if (!configured || (explicit !== undefined && explicit !== configured)) throw new RegistrationLinkError("operator_unavailable");
  return configured;
}

async function currentPolicyProducts(db: Pick<typeof v2Db, "select"> = v2Db) {
  const rows = await db.select({ id: commercialProducts.id, code: commercialProducts.code, isActive: commercialProducts.isActive, visibility: commercialProducts.visibility })
    .from(commercialProducts).where(sql`${commercialProducts.code} IN (${SOUNDSPA_PRODUCT_CODE}, ${DIVNITSA_PRODUCT_CODE})`);
  const basic = rows.find((row) => row.code === SOUNDSPA_PRODUCT_CODE);
  const divnitsa = rows.find((row) => row.code === DIVNITSA_PRODUCT_CODE);
  if (!basic?.isActive || !divnitsa?.isActive || divnitsa.visibility !== "private") throw new RegistrationLinkError("unavailable");
  return { basicProductId: basic.id, divnitsaProductId: divnitsa.id };
}

export async function listRegistrationLinkProducts() {
  const products = await v2Db.select({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name, isActive: commercialProducts.isActive, visibility: commercialProducts.visibility })
    .from(commercialProducts).where(sql`${commercialProducts.code} IN (${SOUNDSPA_PRODUCT_CODE}, ${DIVNITSA_PRODUCT_CODE}, ${SPAQUATORIA_PRODUCT_CODE})`);
  const partners = await v2Db.select({ id: commercialPartners.id, isActive: commercialPartners.isActive }).from(commercialPartners).where(eq(commercialPartners.code, SPAQUATORIA_PARTNER_CODE));
  const partnerActive = partners.some((partner) => partner.isActive);
  return products.filter((product) => product.isActive && (product.code !== DIVNITSA_PRODUCT_CODE || product.visibility === "private") && (product.code !== SPAQUATORIA_PRODUCT_CODE || partnerActive))
    .map(({ id, code, name }) => ({ id, code, name }))
    .sort((left, right) => [SOUNDSPA_PRODUCT_CODE, DIVNITSA_PRODUCT_CODE, SPAQUATORIA_PRODUCT_CODE].indexOf(left.code) - [SOUNDSPA_PRODUCT_CODE, DIVNITSA_PRODUCT_CODE, SPAQUATORIA_PRODUCT_CODE].indexOf(right.code));
}

type RequestedRegistrationLinkProduct = { productId: string; durationMonths: number };
function parseUniversalProducts(value: unknown): RequestedRegistrationLinkProduct[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const seen = new Set<string>();
  const parsed: RequestedRegistrationLinkProduct[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const productId = typeof row.productId === "string" && /^[0-9a-f-]{36}$/i.test(row.productId) ? row.productId : null;
    const durationMonths = row.durationMonths;
    if (!productId || seen.has(productId) || !Number.isInteger(durationMonths) || Number(durationMonths) < 1 || Number(durationMonths) > 12) return null;
    seen.add(productId);
    parsed.push({ productId, durationMonths: Number(durationMonths) });
  }
  return parsed;
}

async function resolveUniversalProducts(value: unknown): Promise<UniversalRegistrationLinkProduct[]> {
  const requested = parseUniversalProducts(value);
  if (!requested) throw new RegistrationLinkError("invalid");
  const rows = await v2Db.select({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name, isActive: commercialProducts.isActive, visibility: commercialProducts.visibility })
    .from(commercialProducts).where(sql`${commercialProducts.id} IN (${sql.join(requested.map((row) => sql`${row.productId}`), sql`, `)})`);
  if (rows.length !== requested.length || rows.some((row) => !row.isActive || ![SOUNDSPA_PRODUCT_CODE, DIVNITSA_PRODUCT_CODE, SPAQUATORIA_PRODUCT_CODE].includes(row.code))) throw new RegistrationLinkError("invalid");
  const partner = await v2Db.select({ id: commercialPartners.id, isActive: commercialPartners.isActive }).from(commercialPartners).where(eq(commercialPartners.code, SPAQUATORIA_PARTNER_CODE));
  const spaPartner = partner.find((row) => row.isActive);
  const result = requested.map((request) => {
    const product = rows.find((row) => row.id === request.productId)!;
    if (product.code === DIVNITSA_PRODUCT_CODE && product.visibility !== "private") throw new RegistrationLinkError("unavailable");
    if (product.code === SPAQUATORIA_PRODUCT_CODE && !spaPartner) throw new RegistrationLinkError("unavailable");
    return {
      productId: product.id,
      productCode: product.code as UniversalRegistrationLinkProduct["productCode"],
      productName: product.name,
      accessType: product.code === SPAQUATORIA_PRODUCT_CODE ? "partner_benefit" as const : "trial" as const,
      durationMonths: request.durationMonths,
      ...(product.code === SPAQUATORIA_PRODUCT_CODE ? { partnerId: spaPartner!.id } : {}),
    };
  });
  return result;
}

export async function createRegistrationLink(input: { operator?: string; reason: unknown; expiresAt?: unknown; maxRedemptions?: unknown; products?: unknown; publicOrigin: string }) {
  const operator = operatorIdentity(input.operator);
  const reason = nonempty(input.reason, 500, 12);
  if (!reason || typeof input.publicOrigin !== "string") throw new RegistrationLinkError("invalid");
  let expiresAt: Date | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== "") {
    expiresAt = input.expiresAt instanceof Date ? input.expiresAt : typeof input.expiresAt === "string" ? new Date(input.expiresAt) : new Date(NaN);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new RegistrationLinkError("invalid");
  }
  let maxRedemptions: number | null = null;
  if (input.maxRedemptions !== undefined && input.maxRedemptions !== null && input.maxRedemptions !== "") {
    const parsed = typeof input.maxRedemptions === "number" ? input.maxRedemptions : typeof input.maxRedemptions === "string" && /^\d+$/.test(input.maxRedemptions) ? Number(input.maxRedemptions) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) throw new RegistrationLinkError("invalid");
    maxRedemptions = parsed;
  }
  let origin: URL;
  try { origin = new URL(input.publicOrigin); } catch { throw new RegistrationLinkError("invalid"); }
  if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new RegistrationLinkError("invalid");
  const token = newOpaqueToken();
  const tokenHash = sha256(token);
  const now = new Date();
  const legacy = input.products === undefined;
  const legacyProducts = legacy ? await currentPolicyProducts() : null;
  const universalProducts = legacy ? null : await resolveUniversalProducts(input.products);
  const policyKey = legacy ? "divnitsa" as const : "universal" as const;
  const policyVersion = legacy ? POLICY_VERSION : UNIVERSAL_POLICY_VERSION;
  const policySnapshot = legacy
    ? { policyKey: "divnitsa" as const, policyVersion: POLICY_VERSION, ...legacyProducts!, basicTrialDays: POLICY_DAYS, divnitsaTrialDays: POLICY_DAYS }
    : { policyKey: "universal" as const, policyVersion: UNIVERSAL_POLICY_VERSION, products: universalProducts! };
  const row = await v2Db.transaction(async (tx) => {
    const [link] = await tx.insert(commercialRegistrationLinks).values({
      tokenHash, policyKey, policyVersion, policySnapshot,
      createdByOperator: operator, creationReason: reason, createdAt: now, expiresAt, maxRedemptions,
    }).returning({ id: commercialRegistrationLinks.id, createdAt: commercialRegistrationLinks.createdAt, expiresAt: commercialRegistrationLinks.expiresAt, maxRedemptions: commercialRegistrationLinks.maxRedemptions });
    await tx.insert(commercialRegistrationLinkEvents).values({ registrationLinkId: link.id, action: "created", operator, reason, beforeState: null, afterState: { policyKey, policyVersion, ...(universalProducts ? { products: universalProducts } : {}), expiresAt: expiresAt?.toISOString() ?? null, maxRedemptions, disabledAt: null } });
    return link;
  });
  return { link: { ...row, status: "active" as const }, url: buildRegistrationLinkUrl(origin.toString(), token) };
}

export async function listRegistrationLinks(now = new Date()) {
  const rows = await v2Db.select({
    id: commercialRegistrationLinks.id, policyKey: commercialRegistrationLinks.policyKey,
    policyVersion: commercialRegistrationLinks.policyVersion, createdByOperator: commercialRegistrationLinks.createdByOperator,
    creationReason: commercialRegistrationLinks.creationReason, createdAt: commercialRegistrationLinks.createdAt,
    expiresAt: commercialRegistrationLinks.expiresAt, maxRedemptions: commercialRegistrationLinks.maxRedemptions,
    disabledAt: commercialRegistrationLinks.disabledAt, disabledByOperator: commercialRegistrationLinks.disabledByOperator,
    disableReason: commercialRegistrationLinks.disableReason, redeemedCount: count(commercialRegistrationLinkRedemptions.id),
    policySnapshot: commercialRegistrationLinks.policySnapshot,
  }).from(commercialRegistrationLinks).leftJoin(commercialRegistrationLinkRedemptions, eq(commercialRegistrationLinkRedemptions.registrationLinkId, commercialRegistrationLinks.id))
    .groupBy(commercialRegistrationLinks.id).orderBy(asc(commercialRegistrationLinks.createdAt), asc(commercialRegistrationLinks.id));
  const histories = await v2Db.select({
    redemption: commercialRegistrationLinkRedemptions,
    email: users.email, organizationName: organizations.name, locationName: locations.name,
  }).from(commercialRegistrationLinkRedemptions)
    .innerJoin(users, eq(users.id, commercialRegistrationLinkRedemptions.verifiedUserId))
    .innerJoin(organizations, eq(organizations.id, commercialRegistrationLinkRedemptions.organizationId))
    .innerJoin(locations, eq(locations.id, commercialRegistrationLinkRedemptions.firstLocationId))
    .orderBy(asc(commercialRegistrationLinkRedemptions.redeemedAt));
  const events = await v2Db.select().from(commercialRegistrationLinkEvents).orderBy(asc(commercialRegistrationLinkEvents.createdAt));
  return rows.map((row) => ({
    ...row, redeemedCount: Number(row.redeemedCount), status: getRegistrationLinkLifecycleStatus(row, Number(row.redeemedCount), now),
    redemptions: histories.filter(({ redemption }) => redemption.registrationLinkId === row.id).map(({ redemption, email, organizationName, locationName }) => ({
      id: redemption.id, email, organizationId: redemption.organizationId, organizationName,
      firstLocationId: redemption.firstLocationId, firstLocationName: locationName, redeemedAt: redemption.redeemedAt,
    })),
    events: events.filter((event) => event.registrationLinkId === row.id).map((event) => ({
      id: event.id, action: event.action, operator: event.operator, reason: event.reason,
      beforeState: event.beforeState, afterState: event.afterState, createdAt: event.createdAt,
    })),
  }));
}

export async function disableRegistrationLink(id: string, input: { operator?: string; reason: unknown }) {
  const operator = operatorIdentity(input.operator);
  const reason = nonempty(input.reason, 500, 12);
  if (!reason || !/^[0-9a-f-]{36}$/i.test(id)) throw new RegistrationLinkError("invalid");
  return v2Db.transaction(async (tx) => {
    const [link] = await tx.select().from(commercialRegistrationLinks).where(eq(commercialRegistrationLinks.id, id)).for("update");
    if (!link) throw new RegistrationLinkError("not_found");
    if (link.disabledAt) return { id: link.id, disabledAt: link.disabledAt, changed: false };
    const now = new Date();
    const beforeState = { policyKey: link.policyKey as "divnitsa" | "universal", policyVersion: link.policyVersion as 1, ...(link.policyKey === "universal" ? { products: (link.policySnapshot as { products: UniversalRegistrationLinkProduct[] }).products } : {}), expiresAt: link.expiresAt?.toISOString() ?? null, maxRedemptions: link.maxRedemptions, disabledAt: null };
    const afterState = { ...beforeState, disabledAt: now.toISOString() };
    const [updated] = await tx.update(commercialRegistrationLinks).set({ disabledAt: now, disabledByOperator: operator, disableReason: reason }).where(eq(commercialRegistrationLinks.id, id)).returning({ id: commercialRegistrationLinks.id, disabledAt: commercialRegistrationLinks.disabledAt });
    await tx.insert(commercialRegistrationLinkEvents).values({ registrationLinkId: id, action: "disabled", operator, reason, beforeState, afterState });
    return { ...updated, changed: true };
  });
}

export async function beginRegistrationLinkSignup(token: string, locale: "en" | "ru" | "vi" | "th", contextTokenHash: string, now = new Date()) {
  if (typeof token !== "string" || token.length < 32 || token.length > 256 || !/^[0-9a-f]{64}$/.test(contextTokenHash)) throw new RegistrationLinkError("link_unavailable");
  return v2Db.transaction(async (tx) => {
    const [link] = await tx.select().from(commercialRegistrationLinks).where(eq(commercialRegistrationLinks.tokenHash, sha256(token))).for("update");
    if (!link || getRegistrationLinkLifecycleStatus(link, Number((await tx.select({ value: count() }).from(commercialRegistrationLinkRedemptions).where(eq(commercialRegistrationLinkRedemptions.registrationLinkId, link.id)))[0]?.value ?? 0), now) !== "active") throw new RegistrationLinkError("link_unavailable");
    const [intent] = await tx.insert(customerSignupIntents).values({ registrationLinkId: link.id, contextTokenHash, locale, expiresAt: new Date(now.getTime() + SIGNUP_INTENT_TTL_MS) }).returning({ id: customerSignupIntents.id });
    return intent;
  });
}

export async function registrationSignupContext(userEmail: string, signupIntentId: string | null) {
  if (!signupIntentId) return false;
  const [intent] = await v2Db.select({ id: customerSignupIntents.id }).from(customerSignupIntents).where(and(
    eq(customerSignupIntents.id, signupIntentId), eq(customerSignupIntents.email, userEmail),
    isNotNull(customerSignupIntents.registrationLinkId), isNotNull(customerSignupIntents.verifiedAt), isNull(customerSignupIntents.completedAt),
  )).limit(1);
  return Boolean(intent);
}

export async function completeRegistrationLinkCustomerOnboarding(input: {
  authenticatedUserId: string; signupIntentId: string | null; organizationName: unknown; locationName: unknown; timezone: unknown;
}, now = new Date()) {
  if (!input.signupIntentId) throw new RegistrationLinkError("signup_context");
  const signupIntentId = input.signupIntentId;
  const names = validateCustomerProvisioningInput({
    organizationName: input.organizationName, locationName: input.locationName, timezone: input.timezone,
    slug: createLocationSlug(typeof input.locationName === "string" ? input.locationName.trim() : "", randomUUID()),
  });
  try {
    return await v2Db.transaction(async (tx) => {
      const [user] = await tx.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
        .from(users).where(eq(users.id, input.authenticatedUserId)).for("update").limit(1);
      if (!user || user.disabledAt) throw new RegistrationLinkError("unauthenticated");
      if (!user.emailVerifiedAt) throw new RegistrationLinkError("unverified");
      const [intent] = await tx.select().from(customerSignupIntents).where(and(
        eq(customerSignupIntents.id, signupIntentId), eq(customerSignupIntents.email, user.email),
        isNotNull(customerSignupIntents.registrationLinkId), gt(customerSignupIntents.expiresAt, now),
      )).for("update").limit(1);
      if (!intent?.registrationLinkId) throw new RegistrationLinkError("signup_context");
      const [existingRedemption] = await tx.select().from(commercialRegistrationLinkRedemptions).where(eq(commercialRegistrationLinkRedemptions.signupIntentId, intent.id)).limit(1);
      if (existingRedemption?.verifiedUserId === user.id) return { status: "already_complete" as const, organizationId: existingRedemption.organizationId, locationId: existingRedemption.firstLocationId };
      if (intent.verifiedAt === null || intent.completedAt !== null) throw new RegistrationLinkError("link_unavailable");
      const [membership] = await tx.select({ id: organizations.id }).from(organizations)
        .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
        .where(eq(organizationMembers.userId, user.id)).limit(1);
      if (membership) throw new RegistrationLinkError("existing_organization");
      const [link] = await tx.select().from(commercialRegistrationLinks).where(eq(commercialRegistrationLinks.id, intent.registrationLinkId)).for("update").limit(1);
      if (!link) throw new RegistrationLinkError("link_unavailable");
      const redeemedCount = Number((await tx.select({ value: count() }).from(commercialRegistrationLinkRedemptions).where(eq(commercialRegistrationLinkRedemptions.registrationLinkId, link.id)))[0]?.value ?? 0);
      const lifecycle = getRegistrationLinkLifecycleStatus(link, redeemedCount, now);
      if ((link.policyKey !== "divnitsa" && link.policyKey !== "universal") || link.policyVersion !== 1 || lifecycle === "disabled" || lifecycle === "expired") throw new RegistrationLinkError("link_unavailable");
      if (link.maxRedemptions !== null && redeemedCount >= link.maxRedemptions) throw new RegistrationLinkError("link_exhausted");
      const policy = link.policySnapshot;
      if (link.policyKey === "universal") {
        if (!policy || policy.policyKey !== "universal" || policy.policyVersion !== UNIVERSAL_POLICY_VERSION || !Array.isArray(policy.products) || policy.products.length < 1 || policy.products.length > 3) throw new RegistrationLinkError("link_unavailable");
        const seen = new Set<string>();
        for (const item of policy.products) {
          if (!item || !/^[0-9a-f-]{36}$/i.test(item.productId) || seen.has(item.productId) || !Number.isInteger(item.durationMonths) || item.durationMonths < 1 || item.durationMonths > 12 || ![SOUNDSPA_PRODUCT_CODE, DIVNITSA_PRODUCT_CODE, SPAQUATORIA_PRODUCT_CODE].includes(item.productCode)) throw new RegistrationLinkError("link_unavailable");
          const expectedAccess = item.productCode === SPAQUATORIA_PRODUCT_CODE ? "partner_benefit" : "trial";
          if (item.accessType !== expectedAccess || !item.productName.trim() || (item.productCode === SPAQUATORIA_PRODUCT_CODE && !item.partnerId)) throw new RegistrationLinkError("link_unavailable");
          seen.add(item.productId);
        }
        const productRows = await tx.select({ id: commercialProducts.id, code: commercialProducts.code, isActive: commercialProducts.isActive, visibility: commercialProducts.visibility }).from(commercialProducts)
          .where(sql`${commercialProducts.id} IN (${sql.join(policy.products.map((item) => sql`${item.productId}`), sql`, `)})`).for("share");
        if (productRows.length !== policy.products.length || policy.products.some((item) => {
          const product = productRows.find((row) => row.id === item.productId);
          return !product?.isActive || product.code !== item.productCode || (item.productCode === DIVNITSA_PRODUCT_CODE && product.visibility !== "private");
        })) throw new RegistrationLinkError("link_unavailable");
        const spaquatoria = policy.products.find((item) => item.productCode === SPAQUATORIA_PRODUCT_CODE);
        if (spaquatoria) {
          const [partner] = await tx.select({ id: commercialPartners.id, code: commercialPartners.code, isActive: commercialPartners.isActive }).from(commercialPartners)
            .where(eq(commercialPartners.id, spaquatoria.partnerId!)).for("share").limit(1);
          if (!partner?.isActive || partner.code !== SPAQUATORIA_PARTNER_CODE) throw new RegistrationLinkError("link_unavailable");
        }
        const { organization, location } = await createCustomerWithFirstLocationInTransaction(tx, names);
        await tx.insert(organizationMembers).values({ organizationId: organization.id, userId: user.id, role: "owner" });
        const divnitsa = policy.products.find((item) => item.productCode === DIVNITSA_PRODUCT_CODE);
        const [redemption] = await tx.insert(commercialRegistrationLinkRedemptions).values({
          registrationLinkId: link.id, signupIntentId: intent.id, verifiedUserId: user.id,
          organizationId: organization.id, firstLocationId: location.id, productId: divnitsa?.productId ?? null, redeemedAt: now,
        }).returning({ id: commercialRegistrationLinkRedemptions.id });
        const granted = [] as { productId: string; productCode: string; accessType: "trial" | "partner_benefit"; startsAt: Date; endsAt: Date }[];
        for (const item of policy.products) {
          const startsAt = new Date(now);
          const endsAt = addBillingCalendarMonths(startsAt, item.durationMonths, billingAnchorForDate(startsAt));
          const [grant] = await tx.insert(commercialRegistrationLinkGrants).values({
            redemptionId: redemption.id, organizationId: organization.id, locationId: location.id,
            productId: item.productId, partnerId: item.partnerId ?? null, accessType: item.accessType,
            durationMonths: item.durationMonths, startsAt, endsAt,
          }).returning({ id: commercialRegistrationLinkGrants.id });
          if (item.accessType === "trial") {
            await tx.insert(locationCoreTrials).values({ locationId: location.id, productId: item.productId, status: "active", startsAt, endsAt, registrationLinkGrantId: grant.id });
          } else {
            await tx.insert(commercialPartnerBenefits).values({ partnerId: item.partnerId!, productId: item.productId, locationId: location.id, startsAt, endsAt, registrationLinkGrantId: grant.id });
          }
          granted.push({ productId: item.productId, productCode: item.productCode, accessType: item.accessType, startsAt, endsAt });
        }
        if (divnitsa) await tx.insert(commercialProductOrganizationAuthorizations).values({
          organizationId: organization.id, productId: divnitsa.productId, grantSource: "registration_link",
          grantedByOperator: null, registrationRedemptionId: redemption.id, grantReason: "Divnitsa Registration Link redemption", grantedAt: now,
        });
        const completedAt = new Date(Math.max(now.getTime(), intent.verifiedAt.getTime() + 1));
        await tx.update(customerSignupIntents).set({ completedAt, updatedAt: completedAt }).where(eq(customerSignupIntents.id, intent.id));
        const basicGrant = granted.find((grant) => grant.productCode === SOUNDSPA_PRODUCT_CODE);
        return { status: "completed" as const, account: { email: user.email, emailVerifiedAt: user.emailVerifiedAt, organization, location, trial: basicGrant ? { status: "active", startsAt: basicGrant.startsAt, endsAt: basicGrant.endsAt } : null }, grants: granted };
      }
      if (policy.policyKey !== "divnitsa" || policy.policyVersion !== POLICY_VERSION || policy.basicTrialDays !== POLICY_DAYS || policy.divnitsaTrialDays !== POLICY_DAYS) throw new RegistrationLinkError("link_unavailable");
      const productRows = await tx.select({ id: commercialProducts.id, code: commercialProducts.code, isActive: commercialProducts.isActive, visibility: commercialProducts.visibility }).from(commercialProducts)
        .where(sql`${commercialProducts.id} IN (${policy.basicProductId}, ${policy.divnitsaProductId})`).for("share");
      const basic = productRows.find((product) => product.id === policy.basicProductId && product.code === SOUNDSPA_PRODUCT_CODE);
      const divnitsa = productRows.find((product) => product.id === policy.divnitsaProductId && product.code === DIVNITSA_PRODUCT_CODE);
      if (!basic?.isActive || !divnitsa?.isActive || divnitsa.visibility !== "private") throw new RegistrationLinkError("link_unavailable");

      const { organization, location } = await createCustomerWithFirstLocationInTransaction(tx, names);
      await tx.insert(organizationMembers).values({ organizationId: organization.id, userId: user.id, role: "owner" });
      const startsAt = now;
      const endsAt = soundSpaBasicTrialEndsAt(startsAt, POLICY_DAYS);
      await startSoundSpaTrial(location.id, tx, POLICY_DAYS, startsAt);
      await tx.insert(locationCoreTrials).values({ locationId: location.id, productId: divnitsa.id, status: "active", startsAt, endsAt });
      const [redemption] = await tx.insert(commercialRegistrationLinkRedemptions).values({
        registrationLinkId: link.id, signupIntentId: intent.id, verifiedUserId: user.id,
        organizationId: organization.id, firstLocationId: location.id, productId: divnitsa.id, redeemedAt: now,
      }).returning({ id: commercialRegistrationLinkRedemptions.id });
      await tx.insert(commercialProductOrganizationAuthorizations).values({
        organizationId: organization.id, productId: divnitsa.id, grantSource: "registration_link",
        grantedByOperator: null, registrationRedemptionId: redemption.id, grantReason: "Divnitsa Registration Link redemption", grantedAt: now,
      });
      const completedAt = new Date(Math.max(now.getTime(), intent.verifiedAt.getTime() + 1));
      await tx.update(customerSignupIntents).set({ completedAt, updatedAt: completedAt }).where(eq(customerSignupIntents.id, intent.id));
      return { status: "completed" as const, account: { email: user.email, emailVerifiedAt: user.emailVerifiedAt, organization, location, trial: { status: "active", startsAt, endsAt } }, divnitsaTrial: { startsAt, endsAt } };
    });
  } catch (error) {
    if (error instanceof RegistrationLinkError) throw error;
    if (pgCode(error) === "23505") throw new RegistrationLinkError("link_unavailable");
    throw new RegistrationLinkError("onboarding_failed");
  }
}
