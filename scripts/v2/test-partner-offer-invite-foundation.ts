import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import {
  commercialOfferGrants,
  commercialOffers,
  commercialPartnerInviteClaims,
  commercialPartnerInvites,
  commercialPartners,
  commercialProducts,
  locations,
  organizations,
} from "../../db/v2/schema";

class Rollback extends Error {}

async function main() {
  let organizationId = "";
  try {
    await v2Db.transaction(async (tx) => {
      const suffix = randomUUID();
      const [partner] = await tx.insert(commercialPartners).values({ code: `p2-test-${suffix}`, name: "P2 Test Partner" }).returning();
      const [offer] = await tx.insert(commercialOffers).values({ partnerId: partner.id, code: "vip", name: "VIP offer" }).returning();
      const [basic] = await tx.insert(commercialProducts).values({ code: `p2-basic-${suffix}`, name: "Basic test product", kind: "core" }).returning();
      const [partnerProduct] = await tx.insert(commercialProducts).values({ code: `p2-partner-${suffix}`, name: "Partner test product", kind: "partner" }).returning();

      // Declarative rows represent a permanent partner benefit and a 30-day
      // trial. This test intentionally does not execute either grant.
      await tx.insert(commercialOfferGrants).values([
        { offerId: offer.id, productId: partnerProduct.id, grantType: "partner_benefit", durationDays: null },
        { offerId: offer.id, productId: basic.id, grantType: "trial", durationDays: 30 },
      ]);
      assert.equal((await tx.select().from(commercialOfferGrants).where(eq(commercialOfferGrants.offerId, offer.id))).length, 2);

      const plaintextToken = `opaque-${suffix}`;
      const tokenHash = createHash("sha256").update(plaintextToken).digest("hex");
      const expiresAt = new Date(Date.now() + 86_400_000);
      const [invite] = await tx.insert(commercialPartnerInvites).values({ offerId: offer.id, tokenHash, expiresAt, maxClaims: 3 }).returning();
      assert.equal(invite.tokenHash, tokenHash);
      assert.equal("token" in invite, false, "only the token hash is represented by the invite row");
      assert.equal(JSON.stringify(invite).includes(plaintextToken), false, "plaintext token is not returned or persisted by the invite model");
      await tx.update(commercialPartnerInvites).set({ revokedAt: new Date() }).where(eq(commercialPartnerInvites.id, invite.id));

      // Expected unique/check violations run under savepoints so the outer
      // rollback-only fixture remains usable.
      await assert.rejects(
        tx.transaction(async (nested) => {
          await nested.insert(commercialPartnerInvites).values({ offerId: offer.id, tokenHash });
        }),
        /unique|duplicate/i,
      );
      await assert.rejects(
        tx.transaction(async (nested) => {
          await nested.insert(commercialOfferGrants).values({ offerId: offer.id, productId: basic.id, grantType: "trial", durationDays: 0 });
        }),
        /check|duration/i,
      );

      const [organization] = await tx.insert(organizations).values({ name: `p2-invite-test-${suffix}` }).returning();
      organizationId = organization.id;
      const [location] = await tx.insert(locations).values({ organizationId, name: "Invite test location", slug: `p2-invite-${suffix}`, timezone: "UTC" }).returning();
      await tx.insert(commercialPartnerInviteClaims).values({ inviteId: invite.id, locationId: location.id });
      await assert.rejects(
        tx.transaction(async (nested) => {
          await nested.insert(commercialPartnerInviteClaims).values({ inviteId: invite.id, locationId: location.id });
        }),
        /unique|duplicate/i,
      );
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
  console.info("Partner offer/invite foundation PASS: partner-scoped offer, multiple product grants (permanent benefit + 30-day trial), hash-only invite, lifecycle fields, uniqueness/check constraints, idempotent claim identity, and transaction rollback.");
  await v2Pool.end();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
