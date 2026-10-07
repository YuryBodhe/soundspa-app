import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { recordNormalizedPayment, resolveEnabledPaymentRoutesForLocationProduct } from "../../db/v2/services/paymentFoundation";
import { commercialPaymentEvents, commercialPaymentProviders, commercialPaymentRoutes, commercialPayments, commercialProducts, locations, organizations } from "../../db/v2/schema";

class Rollback extends Error {}

async function main() {
  let organizationId = "";
  try {
    await v2Db.transaction(async (tx) => {
      const suffix = randomUUID();
      const providerA = `provider-a-${suffix}`;
      const providerB = `provider-b-${suffix}`;
      const providerOff = `provider-off-${suffix}`;
      const [organization] = await tx.insert(organizations).values({ name: `payment-foundation-${suffix}` }).returning();
      organizationId = organization.id;
      const [location] = await tx.insert(locations).values({ organizationId, name: "VN Location", slug: `payment-vn-${suffix}`, timezone: "Asia/Ho_Chi_Minh", marketCode: "VN" }).returning();
      const [otherMarketLocation] = await tx.insert(locations).values({ organizationId, name: "TH Location", slug: `payment-th-${suffix}`, timezone: "Asia/Bangkok", marketCode: "TH" }).returning();
      const [product] = await tx.insert(commercialProducts).values({ code: `payment-${suffix}`, name: "Test Product", kind: "core" }).returning();
      await tx.insert(commercialPaymentProviders).values([
        { code: providerA, displayName: "Provider A", isEnabled: true },
        { code: providerB, displayName: "Provider B", isEnabled: true },
        { code: providerOff, displayName: "Disabled Provider", isEnabled: false },
      ]);
      const [routeA] = await tx.insert(commercialPaymentRoutes).values({ marketCode: "VN", productId: product.id, providerCode: providerA, externalReference: "plan-a", displayOrder: 20 }).returning();
      const [routeB] = await tx.insert(commercialPaymentRoutes).values({ marketCode: "VN", productId: product.id, providerCode: providerB, externalReference: "plan-b", displayOrder: 10 }).returning();
      await tx.insert(commercialPaymentRoutes).values([
        { marketCode: "VN", productId: product.id, providerCode: providerA, externalReference: "disabled-route", isEnabled: false, displayOrder: 0 },
        { marketCode: "VN", productId: product.id, providerCode: providerOff, externalReference: "provider-disabled", displayOrder: 0 },
      ]);

      const availableRoutes = await resolveEnabledPaymentRoutesForLocationProduct(location.id, product.id, tx);
      assert.deepEqual(availableRoutes.map((route) => route.id), [routeB.id, routeA.id]);
      assert.deepEqual(await resolveEnabledPaymentRoutesForLocationProduct(otherMarketLocation.id, product.id, tx), []);

      const first = {
        providerCode: providerA, paymentKey: "charge-1", idempotencyKey: "event-1", externalEventId: "event-1", externalPaymentId: "charge-1",
        locationId: location.id, productId: product.id, subscriptionId: null, routeId: routeA.id, externalSubscriptionRef: "external-sub-1",
        status: "succeeded" as const, amountMinor: BigInt(90000), currency: "VND", occurredAt: new Date("2026-10-01T00:00:00Z"),
      };
      const recorded = await recordNormalizedPayment(first, tx);
      const replay = await recordNormalizedPayment(first, tx);
      assert.equal(recorded.duplicate, false);
      assert.deepEqual(replay, { duplicate: true, paymentId: recorded.paymentId });
      const [payment] = await tx.select().from(commercialPayments).where(eq(commercialPayments.id, recorded.paymentId));
      assert.equal(payment.amountMinor, BigInt(90000));
      assert.equal(payment.currency, "VND");
      assert.equal(payment.status, "succeeded");

      const recurring = await recordNormalizedPayment({
        ...first, paymentKey: "charge-2", idempotencyKey: "event-2", externalEventId: "event-2", externalPaymentId: "charge-2",
        occurredAt: new Date("2026-11-01T00:00:00Z"), amountMinor: BigInt(80000),
      }, tx);
      assert.notEqual(recurring.paymentId, recorded.paymentId);

      await assert.rejects(recordNormalizedPayment({ ...first, paymentKey: "other-charge", idempotencyKey: "event-conflict", status: "failed" }, tx),
        (error: unknown) => error instanceof Error && error.message === "payment_event_identity_conflict");
      assert.equal((await tx.select().from(commercialPayments)).length, 2);
      assert.equal((await tx.select().from(commercialPaymentEvents)).length, 2);
      throw new Rollback();
    });
  } catch (error) { if (!(error instanceof Rollback)) throw error; }
  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
  console.info("Payment foundation integration PASS: explicit market routing, multi-provider routes, disabled filtering, deterministic ordering, actual amount/currency, event replay idempotency, recurring transaction identity, and rollback.");
  await v2Pool.end();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
