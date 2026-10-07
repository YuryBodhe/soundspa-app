import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialProducts,
  customerSignupIntents,
  locationCoreTrials,
  locations,
  organizationMembers,
  organizations,
  users,
} from "../schema";
import { startSoundSpaTrial } from "../queries/coreTrials";
import { SOUNDSPA_PRODUCT_CODE } from "../queries/commercialProducts";
import { createCustomerWithFirstLocationInTransaction, validateCustomerProvisioningInput } from "./customerProvisioning";
import { createLocationSlug } from "@/lib/v2/customerOnboarding";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;
type OnboardingDetails = {
  email: string;
  emailVerifiedAt: Date;
  organization: { id: string; name: string } | null;
  location: { id: string; name: string; slug: string; timezone: string } | null;
  trial: { status: string; startsAt: Date; endsAt: Date } | null;
};

export class CustomerOnboardingError extends Error {
  constructor(readonly code: "unauthenticated" | "unverified" | "partner_context" | "invalid" | "already_complete") {
    super(code);
    this.name = "CustomerOnboardingError";
  }
}

async function loadExistingOnboarding(tx: V2Transaction, userId: string): Promise<OnboardingDetails | null> {
  const [membership] = await tx.select({ organization: organizations, user: users })
    .from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.userId, userId)).orderBy(asc(organizationMembers.createdAt)).limit(1);
  if (!membership) return null;
  const [location] = await tx.select().from(locations)
    .where(eq(locations.organizationId, membership.organization.id)).orderBy(asc(locations.createdAt)).limit(1);
  if (!location) throw new Error("Customer membership exists without a Location.");
  const [trialRow] = await tx.select({ trial: locationCoreTrials })
    .from(locationCoreTrials).innerJoin(commercialProducts, eq(commercialProducts.id, locationCoreTrials.productId))
    .where(and(eq(locationCoreTrials.locationId, location.id), eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE))).limit(1);
  return {
    email: membership.user.email,
    emailVerifiedAt: membership.user.emailVerifiedAt!,
    organization: { id: membership.organization.id, name: membership.organization.name },
    location: { id: location.id, name: location.name, slug: location.slug, timezone: location.timezone },
    trial: trialRow ? { status: trialRow.trial.status, startsAt: trialRow.trial.startsAt, endsAt: trialRow.trial.endsAt } : null,
  };
}

export async function getCustomerOnboarding(userId: string): Promise<OnboardingDetails | null> {
  const [user] = await v2Db.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.emailVerifiedAt) return null;
  return v2Db.transaction(async (tx) => await loadExistingOnboarding(tx, userId) ?? {
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt!,
    organization: null,
    location: null,
    trial: null,
  });
}

export async function isPartnerSignupContext(userEmail: string): Promise<boolean> {
  const [intent] = await v2Db.select({ id: customerSignupIntents.id })
    .from(customerSignupIntents).where(and(eq(customerSignupIntents.email, userEmail), isNotNull(customerSignupIntents.inviteTokenHash))).limit(1);
  return Boolean(intent);
}

export async function completeOrdinaryCustomerOnboarding(input: {
  authenticatedUserId: string;
  signupIntentId: string | null;
  organizationName: unknown;
  locationName: unknown;
  timezone: unknown;
}, dependencies: {
  runInTransaction?: TransactionRunner;
  createTrial?: typeof startSoundSpaTrial;
  createOwnerMembership?: (tx: V2Transaction, organizationId: string, userId: string) => Promise<unknown>;
} = {}) {
  const names = validateCustomerProvisioningInput({
    organizationName: input.organizationName,
    locationName: input.locationName,
    timezone: input.timezone,
    slug: createLocationSlug(typeof input.locationName === "string" ? input.locationName.trim() : "", randomUUID()),
  });

  const runInTransaction = dependencies.runInTransaction ?? ((operation) => v2Db.transaction(operation));
  const createTrial = dependencies.createTrial ?? startSoundSpaTrial;
  const createOwnerMembership = dependencies.createOwnerMembership ?? ((tx, organizationId, userId) =>
    tx.insert(organizationMembers).values({ organizationId, userId, role: "owner" }));
  return runInTransaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
      .from(users).where(eq(users.id, input.authenticatedUserId)).limit(1).for("update");
    if (!user || user.disabledAt) throw new CustomerOnboardingError("unauthenticated");
    if (!user.emailVerifiedAt) throw new CustomerOnboardingError("unverified");

    if (input.signupIntentId) {
      const [sessionIntent] = await tx.select({ id: customerSignupIntents.id })
        .from(customerSignupIntents).where(and(eq(customerSignupIntents.id, input.signupIntentId), eq(customerSignupIntents.email, user.email))).limit(1);
      if (!sessionIntent) throw new CustomerOnboardingError("unauthenticated");
    }
    const [partnerIntent] = await tx.select({ id: customerSignupIntents.id }).from(customerSignupIntents)
      .where(and(eq(customerSignupIntents.email, user.email), isNotNull(customerSignupIntents.inviteTokenHash))).limit(1);
    if (partnerIntent) throw new CustomerOnboardingError("partner_context");

    const existing = await loadExistingOnboarding(tx, user.id);
    if (existing) return { status: "already_complete" as const, account: existing };

    const { organization, location } = await createCustomerWithFirstLocationInTransaction(tx, names);
    await createOwnerMembership(tx, organization.id, user.id);
    const trial = await createTrial(location.id, tx);
    return {
      status: "completed" as const,
      account: {
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        organization,
        location,
        trial: { status: trial.status, startsAt: trial.startsAt, endsAt: trial.endsAt },
      },
    };
  });
}
