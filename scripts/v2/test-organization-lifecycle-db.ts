import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import {
  commercialBillingResets, commercialOrganizationPayerReference,
  commercialPartnerBenefits, commercialPartnerInviteClaims, commercialPartnerInvites, commercialOffers, commercialPartners,
  commercialPaymentRoutes, commercialProductChannels, commercialProductOrganizationAuthorizations, commercialProducts, commercialRegistrationLinkRedemptions,
  commercialRegistrationLinks, commercialSpaquatoriaPromoCodes, commercialSpaquatoriaPromoRedemptions,
  devices, giftAccessInvitations, locationCoreTrials, locationSubscriptions, locations, monitoringLifecycleEvents,
  organizationLifecycleEvents, organizationMembers, organizations, users, channels, customerSignupIntents,
} from "../../db/v2/schema";
import { assertOrganizationHasNoProtectedHistory, ORGANIZATION_DELETION_BLOCKERS } from "../../db/v2/services/organizationLifecycle";
import { deleteOrganization } from "../../db/v2/services/organizationDeletion";
import { archiveOrganization, restoreOrganization } from "../../db/v2/services/organizationLifecycle";
import { authenticateDeviceCredential } from "../../db/v2/queries/devices";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { listCustomerBilling } from "../../db/v2/services/customerBilling";
import { listCustomerLocationsWithDevices } from "../../db/v2/services/customerDevices";
import { createManualBankTransferBillingOrder } from "../../db/v2/services/billingOrders";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const operator = "lifecycle integration operator";
const reason = "Approved isolated lifecycle integration test";

async function assertDisposableLocalDatabase() {
  assert.equal(process.env.V2_LIFECYCLE_TEST_DISPOSABLE, "1", "Set V2_LIFECYCLE_TEST_DISPOSABLE=1 only for the disposable local PostgreSQL database.");
  const url = new URL(process.env.V2_DATABASE_URL ?? "");
  assert.equal(decodeURIComponent(url.pathname), "/soundspa_v2");
  assert(["127.0.0.1", "localhost", "::1"].includes(url.hostname), "This integration test only runs against loopback PostgreSQL.");
  assert.notEqual(url.port || "5432", "5432", "Use a dedicated non-default local PostgreSQL port, never an application endpoint.");
  const identity = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS username, inet_server_port() AS port`);
  assert.equal(identity.rows[0]?.database, "soundspa_v2");
  assert.equal(identity.rows[0]?.username, "soundspa_v2");
  assert.equal(Number(identity.rows[0]?.port), Number(url.port));
  const migrationResult = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`);
  const migration = migrationResult.rows[0];
  assert(Number(migration.count) >= 33, "Apply V2 migrations through 0033 on the disposable database first.");
}

async function seedEveryProtectedCategory() {
  const marker = randomUUID();
  const oldUsername = process.env.V2_ADMIN_USERNAME;
  const oldPassword = process.env.V2_ADMIN_PASSWORD;
  process.env.V2_ADMIN_USERNAME = operator;
  process.env.V2_ADMIN_PASSWORD = "isolated-lifecycle-test-only";
  const operatorAuthorization = `Basic ${Buffer.from(`${operator}:isolated-lifecycle-test-only`).toString("base64")}`;
  try { await v2Db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: `Lifecycle protected ${marker}` }).returning({ id: organizations.id, name: organizations.name });
    const [location] = await tx.insert(locations).values({ organizationId: org.id, name: "Lifecycle fixture", slug: `life-${marker.slice(0, 8)}`, timezone: "UTC", marketCode: "RU" }).returning({ id: locations.id });
    const [product] = await tx.insert(commercialProducts).values({ code: `life-${marker}`, name: `Lifecycle ${marker}`, kind: "core" }).returning({ id: commercialProducts.id });
    const [partner] = await tx.insert(commercialPartners).values({ code: `life-${marker}`, name: `Lifecycle ${marker}` }).returning({ id: commercialPartners.id });
    const userEmail = `${marker}@lifecycle.invalid`;
    const [user] = await tx.insert(users).values({ email: userEmail, displayName: "Lifecycle fixture" }).returning({ id: users.id });
    const [channel] = await tx.insert(channels).values({ slug: `life-${marker.slice(0, 8)}`, displayName: "Lifecycle fixture", kind: "music", isPublished: false, sortOrder: 9999 }).returning({ id: channels.id });
    const providerResult = await tx.execute(sql`SELECT code FROM commercial_payment_providers WHERE code = 'manual-bank-transfer' LIMIT 1`);
    const provider = providerResult.rows[0] as { code: string } | undefined;
    assert(provider?.code, "Manual Billing provider must be seeded by V2 migrations.");
    const now = new Date();
    const future = new Date(now.getTime() + 86_400_000);

    await tx.insert(commercialPaymentRoutes).values({ marketCode: "RU", productId: product.id, providerCode: provider.code, externalReference: `lifecycle:${marker}` });
    await createManualBankTransferBillingOrder({
      organizationId: org.id, operatorAuthorization, reason, idempotencyKey: `life-${marker}`,
      periodStart: "2031-01-01", periodEnd: "2031-02-01", currency: "RUB", totalAmountMinor: "100",
      invoiceNumber: `LIFE-${marker.slice(0, 8)}`, invoiceIssuedAt: "2030-12-01", paymentDueAt: "2030-12-20",
      lines: [{ locationId: location.id, productId: product.id }],
    }, { db: tx, now: new Date("2030-12-01T00:00:00.000Z") });
    await tx.insert(locationSubscriptions).values({ locationId: location.id, productId: product.id, provider: provider.code, status: "active", startsAt: now, currentPeriodEndsAt: future });
    await tx.insert(locationCoreTrials).values({ locationId: location.id, productId: product.id, status: "active", startsAt: now, endsAt: future });
    await tx.insert(commercialPartnerBenefits).values({ partnerId: partner.id, productId: product.id, locationId: location.id, startsAt: now });
    const promoHash = hash(`promo-${marker}`);
    const [promo] = await tx.insert(commercialSpaquatoriaPromoCodes).values({ tokenHash: promoHash, partnerId: partner.id, productId: product.id, durationDays: 1, createdByOperator: operator, creationReason: reason }).returning({ id: commercialSpaquatoriaPromoCodes.id });
    await tx.insert(commercialSpaquatoriaPromoRedemptions).values({ promoCodeId: promo.id, verifiedUserId: user.id, organizationId: org.id, locationId: location.id, partnerId: partner.id, productId: product.id, requestedDurationDays: 1, grantedDurationMs: 86_400_000 });
    const linkHash = hash(`link-${marker}`);
    const [link] = await tx.insert(commercialRegistrationLinks).values({ tokenHash: linkHash, policyKey: "universal", policyVersion: 1, policySnapshot: { policyKey: "universal", policyVersion: 1, products: [{ productId: product.id, productCode: "soundspa", productName: "Lifecycle", accessType: "trial", durationMonths: 1 }] }, createdByOperator: operator, creationReason: reason }).returning({ id: commercialRegistrationLinks.id });
    const [intent] = await tx.insert(customerSignupIntents).values({ email: userEmail, locale: "en", registrationLinkId: link.id, expiresAt: future }).returning({ id: customerSignupIntents.id });
    await tx.insert(commercialRegistrationLinkRedemptions).values({ registrationLinkId: link.id, signupIntentId: intent.id, verifiedUserId: user.id, organizationId: org.id, firstLocationId: location.id, productId: product.id });
    await tx.insert(commercialProductOrganizationAuthorizations).values({ organizationId: org.id, productId: product.id, grantedByOperator: operator, grantReason: "test" });
    await tx.insert(commercialBillingResets).values({ organizationId: org.id, locationId: location.id, productIds: [product.id], operator, reason, trialDurationDays: 30, affectedRecords: { subscriptions: [], trials: [], ordersCanceled: [], paymentsCanceled: [], legacyLocationAccess: null } });
    await tx.insert(giftAccessInvitations).values({ tokenHash: hash(`gift-${marker}`), channelId: channel.id, duration: "3_months", durationMonths: 3, createdByOperator: operator, redeemedAt: now, redeemedOrganizationId: org.id, redeemedByUserId: user.id });
    await tx.insert(commercialOrganizationPayerReference).values({ organizationId: org.id, provider: provider.code });
    const [offer] = await tx.insert(commercialOffers).values({ partnerId: partner.id, code: `life-${marker}`, name: "Lifecycle fixture" }).returning({ id: commercialOffers.id });
    const [invite] = await tx.insert(commercialPartnerInvites).values({ offerId: offer.id, tokenHash: hash(`invite-${marker}`) }).returning({ id: commercialPartnerInvites.id });
    await tx.insert(commercialPartnerInviteClaims).values({ inviteId: invite.id, locationId: location.id });

    const expected = [...ORGANIZATION_DELETION_BLOCKERS].sort();
    await assert.rejects(assertOrganizationHasNoProtectedHistory(tx, org.id), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "protected_history");
      assert.deepEqual((error as { blockers?: string[] }).blockers?.sort(), expected);
      return true;
    });
    throw new Error("ROLLBACK_LIFECYCLE_FIXTURES");
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== "ROLLBACK_LIFECYCLE_FIXTURES") throw error;
  }); } finally {
    if (oldUsername === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = oldUsername;
    if (oldPassword === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = oldPassword;
  }
}

async function main() {
  await assertDisposableLocalDatabase();
  await seedEveryProtectedCategory();

  const marker = randomUUID();
  const [org] = await v2Db.insert(organizations).values({ name: `Lifecycle archive ${marker}` }).returning({ id: organizations.id, name: organizations.name });
  const [location] = await v2Db.insert(locations).values({ organizationId: org.id, name: "Archive fixture", slug: `arch-${marker.slice(0, 8)}`, timezone: "UTC" }).returning({ id: locations.id });
  const [owner] = await v2Db.insert(users).values({ email: `${marker}@archive-lifecycle.invalid`, displayName: "Archive lifecycle owner", emailVerifiedAt: new Date() }).returning({ id: users.id });
  await v2Db.insert(organizationMembers).values({ organizationId: org.id, userId: owner.id, role: "owner" });
  const credential = randomBytes(32).toString("base64url");
  const [device] = await v2Db.insert(devices).values({ locationId: location.id, label: "Archive fixture", credentialHash: hash(credential) }).returning({ id: devices.id });
  const [product] = await v2Db.insert(commercialProducts).values({ code: `arch-${marker}`, name: "Archive entitlement", kind: "core" }).returning({ id: commercialProducts.id });
  const [channel] = await v2Db.insert(channels).values({ slug: `arch-${marker.slice(0, 8)}`, displayName: "Archive entitlement", kind: "music", isPublished: true, sortOrder: 9998 }).returning({ id: channels.id });
  await v2Db.insert(commercialProductChannels).values({ productId: product.id, channelId: channel.id });
  const providerResult = await v2Db.execute(sql`SELECT code FROM commercial_payment_providers WHERE code = 'manual-bank-transfer' LIMIT 1`);
  const provider = providerResult.rows[0] as { code: string } | undefined;
  assert(provider?.code);
  const now = new Date();
  const future = new Date(now.getTime() + 86_400_000);
  await v2Db.insert(locationSubscriptions).values({ locationId: location.id, productId: product.id, provider: provider.code, status: "active", startsAt: new Date(now.getTime() - 60_000), currentPeriodEndsAt: future });
  await v2Db.insert(locationCoreTrials).values({ locationId: location.id, productId: product.id, status: "active", startsAt: new Date(now.getTime() - 60_000), endsAt: future });
  const subscriptionsBefore = await v2Db.select().from(locationSubscriptions).where(eq(locationSubscriptions.locationId, location.id));
  const trialsBefore = await v2Db.select().from(locationCoreTrials).where(eq(locationCoreTrials.locationId, location.id));
  const beforeOrgHistory = await v2Db.select().from(organizationLifecycleEvents).where(eq(organizationLifecycleEvents.organizationId, org.id));
  assert.equal((await authenticateDeviceCredential(credential))?.deviceId, device.id, "active Organization and Location must authorize the existing Device");
  assert.equal((await listCustomerLocationsWithDevices(owner.id)).length, 1);
  assert.equal((await listCustomerBilling(owner.id)).locations.length, 1);
  // A device can only authenticate when its Organization and Location are active.
  // Archive/restore toggles that same authorization boundary without touching the Device credential.
  const archived = await archiveOrganization(org.id, org.name, reason, operator);
  assert.equal(archived.changed, true);
  const [afterArchive] = await v2Db.select({ archivedAt: organizations.archivedAt }).from(organizations).where(eq(organizations.id, org.id));
  assert(afterArchive?.archivedAt);
  const afterArchiveDevice = await authenticateDeviceCredential(credential);
  assert.equal(afterArchiveDevice, null);
  assert.equal((await listCustomerLocationsWithDevices(owner.id)).length, 0, "archived Organization is hidden from customer device/location access");
  assert.equal((await listCustomerBilling(owner.id)).locations.length, 0, "archived Organization is hidden from customer billing");
  assert.deepEqual(await v2Db.select().from(locationSubscriptions).where(eq(locationSubscriptions.locationId, location.id)), subscriptionsBefore);
  assert.deepEqual(await v2Db.select().from(locationCoreTrials).where(eq(locationCoreTrials.locationId, location.id)), trialsBefore);
  const restored = await restoreOrganization(org.id, org.name, reason, operator);
  assert.equal(restored.changed, true);
  assert.equal((await authenticateDeviceCredential(credential))?.deviceId, device.id);
  assert.equal((await listCustomerLocationsWithDevices(owner.id)).length, 1);
  assert.equal((await listCustomerBilling(owner.id)).locations.length, 1);
  const restoredAccess = new Map((await resolveEffectiveChannelAccess(location.id, new Date())).map((entry) => [entry.id, entry]));
  assert.deepEqual(restoredAccess.get(channel.id)?.accessSources.sort(), ["subscription", "trial"]);
  assert.deepEqual(await v2Db.select().from(locationSubscriptions).where(eq(locationSubscriptions.locationId, location.id)), subscriptionsBefore, "restore must not extend paid coverage");
  assert.deepEqual(await v2Db.select().from(locationCoreTrials).where(eq(locationCoreTrials.locationId, location.id)), trialsBefore, "restore must not recreate or extend a trial");
  assert.deepEqual(await v2Db.select().from(organizationLifecycleEvents).where(eq(organizationLifecycleEvents.organizationId, org.id)).then((events) => events.map(({ action, operator: actor, reason: auditReason }) => ({ action, actor, reason: auditReason }))), [
    { action: "archived", actor: operator, reason }, { action: "restored", actor: operator, reason },
  ]);
  const duplicateArchives = await Promise.all([
    archiveOrganization(org.id, org.name, "Concurrent duplicate archive request", operator),
    archiveOrganization(org.id, org.name, "Concurrent duplicate archive request", operator),
  ]);
  assert.deepEqual(duplicateArchives.map((result) => result.changed).sort(), [false, true], "row locking makes concurrent duplicate archive idempotent");
  const deleteAndRestore = await Promise.allSettled([
    deleteOrganization(org.id, org.name),
    restoreOrganization(org.id, org.name, "Restore while delete is blocked", operator),
  ]);
  assert.equal(deleteAndRestore[0].status, "rejected");
  assert.equal((deleteAndRestore[0] as PromiseRejectedResult).reason.code, "protected_history");
  assert.equal(deleteAndRestore[1].status, "fulfilled");
  assert.equal((await v2Db.select().from(locations).where(eq(locations.id, location.id))).length, 1, "concurrent blocked deletion cannot remove the Location");
  const archiveRestoreRace = await Promise.all([
    archiveOrganization(org.id, org.name, "Archive restore race archive", operator, new Date("2032-01-01T00:00:00.000Z")),
    restoreOrganization(org.id, org.name, "Archive restore race restore", operator, new Date("2032-01-01T00:00:00.001Z")),
  ]);
  assert(archiveRestoreRace.every((result) => typeof result.changed === "boolean"));
  const latestLifecycleEvent = await v2Db.select().from(organizationLifecycleEvents).where(eq(organizationLifecycleEvents.organizationId, org.id)).orderBy(organizationLifecycleEvents.occurredAt);
  const [concurrentState] = await v2Db.select({ archivedAt: organizations.archivedAt }).from(organizations).where(eq(organizations.id, org.id));
  if (latestLifecycleEvent.length) assert.equal(concurrentState.archivedAt === null, latestLifecycleEvent.at(-1)?.action === "restored", "concurrent state matches the last committed lifecycle transition");
  assert.deepEqual(beforeOrgHistory, []);

  const [empty] = await v2Db.insert(organizations).values({ name: `Lifecycle delete ${marker}` }).returning({ id: organizations.id, name: organizations.name });
  const [emptyLocation] = await v2Db.insert(locations).values({ organizationId: empty.id, name: "Delete fixture", slug: `del-${marker.slice(0, 8)}`, timezone: "UTC" }).returning({ id: locations.id });
  await v2Db.insert(devices).values({ locationId: emptyLocation.id, label: "Delete fixture" });
  const deleted = await deleteOrganization(empty.id, empty.name);
  assert.equal(deleted.removed.locations, 1);
  assert.equal(deleted.removed.devices, 1);
  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, empty.id))).length, 0);

  const [blocked] = await v2Db.insert(organizations).values({ name: `Lifecycle blocked ${marker}` }).returning({ id: organizations.id, name: organizations.name });
  const [blockedLocation] = await v2Db.insert(locations).values({ organizationId: blocked.id, name: "Blocked fixture", slug: `blk-${marker.slice(0, 8)}`, timezone: "UTC" }).returning({ id: locations.id });
  await v2Db.insert(devices).values({ locationId: blockedLocation.id, label: "Must survive blocked delete" });
  const [blockedProduct] = await v2Db.insert(commercialProducts).values({ code: `blk-${marker}`, name: "Blocked fixture", kind: "core" }).returning({ id: commercialProducts.id });
  await v2Db.insert(commercialProductOrganizationAuthorizations).values({ organizationId: blocked.id, productId: blockedProduct.id, grantedByOperator: operator, grantReason: "test" });
  const devicesBefore = await v2Db.select().from(devices).where(eq(devices.locationId, blockedLocation.id));
  const auditBefore = await v2Db.select().from(monitoringLifecycleEvents).where(eq(monitoringLifecycleEvents.organizationId, blocked.id));
  await assert.rejects(deleteOrganization(blocked.id, blocked.name), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "protected_history");
    assert((error as { blockers?: string[] }).blockers?.includes("product_authorizations"));
    return true;
  });
  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, blocked.id))).length, 1);
  assert.equal((await v2Db.select().from(locations).where(eq(locations.id, blockedLocation.id))).length, 1);
  assert.deepEqual(await v2Db.select().from(devices).where(eq(devices.locationId, blockedLocation.id)), devicesBefore);
  assert.deepEqual(await v2Db.select().from(monitoringLifecycleEvents).where(eq(monitoringLifecycleEvents.organizationId, blocked.id)), auditBefore);

  // Remove only this script's fixed, synthetic rows in the explicitly disposable local DB.
  await v2Db.transaction(async (tx) => {
    await tx.delete(organizationLifecycleEvents).where(eq(organizationLifecycleEvents.organizationId, org.id));
    await tx.delete(monitoringLifecycleEvents).where(eq(monitoringLifecycleEvents.organizationId, org.id));
    await tx.delete(devices).where(eq(devices.id, device.id));
    await tx.delete(organizationMembers).where(eq(organizationMembers.organizationId, org.id));
    await tx.delete(users).where(eq(users.id, owner.id));
    await tx.delete(locationSubscriptions).where(eq(locationSubscriptions.locationId, location.id));
    await tx.delete(locationCoreTrials).where(eq(locationCoreTrials.locationId, location.id));
    await tx.delete(commercialProductChannels).where(eq(commercialProductChannels.productId, product.id));
    await tx.delete(channels).where(eq(channels.id, channel.id));
    await tx.delete(commercialProducts).where(eq(commercialProducts.id, product.id));
    await tx.delete(locations).where(eq(locations.id, location.id));
    await tx.delete(organizations).where(eq(organizations.id, org.id));
    await tx.delete(organizationLifecycleEvents).where(eq(organizationLifecycleEvents.organizationId, blocked.id));
    await tx.delete(monitoringLifecycleEvents).where(eq(monitoringLifecycleEvents.organizationId, blocked.id));
    await tx.delete(commercialProductOrganizationAuthorizations).where(eq(commercialProductOrganizationAuthorizations.organizationId, blocked.id));
    await tx.delete(devices).where(eq(devices.locationId, blockedLocation.id));
    await tx.delete(locations).where(eq(locations.id, blockedLocation.id));
    await tx.delete(organizations).where(eq(organizations.id, blocked.id));
    await tx.delete(commercialProducts).where(eq(commercialProducts.id, blockedProduct.id));
  });
  assert.equal((await v2Db.execute(sql`SELECT count(*)::int AS count FROM organizations WHERE name LIKE 'Lifecycle %'`)).rows[0]?.count, 0);
  assert.equal((await v2Db.execute(sql`SELECT count(*)::int AS count FROM organization_lifecycle_events WHERE organization_name LIKE 'Lifecycle %'`)).rows[0]?.count, 0);
  console.info("V2 Organization lifecycle PostgreSQL integration PASS: all protected blocker categories; deletion rollback; archive/restore audit; player/device access disable and restore; no commercial history changed.");
  await v2Pool.end();
}

main().catch((error: unknown) => {
  const safe = error instanceof Error ? `${error.name}: ${error.message.slice(0, 260)} ${error.stack?.split("\n").slice(1, 3).join(" | ") ?? ""}` : typeof error;
  console.error(`V2 Organization lifecycle integration failed: ${safe}`);
  process.exitCode = 1;
});
