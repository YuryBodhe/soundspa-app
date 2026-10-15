import assert from "node:assert/strict";
import { isIP } from "node:net";
import { createHash, randomUUID } from "node:crypto";

const databaseUrl = process.env.V2_DATABASE_URL;
if (process.env.V2_SPAQUATORIA_PROMO_TEST_ALLOW_DATABASE !== "1" || !databaseUrl) {
  throw new Error("Refusing Spaquatoria promo integration test: explicit opt-in and a disposable local database are required.");
}
const target = new URL(databaseUrl);
const role = decodeURIComponent(target.username);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname) || decodeURIComponent(target.pathname) !== "/soundspa_v2" ||
    role !== "soundspa_v2_test" || (target.port && target.port !== "5432")) {
  throw new Error("Refusing Spaquatoria promo integration test: require loopback PostgreSQL database soundspa_v2 and role soundspa_v2_test.");
}
process.env.V2_ADMIN_USERNAME = `spa-promo-test-${randomUUID().slice(0, 8)}`;

async function main() {
  const [{ v2Db, v2Pool }, schema, promoService] = await Promise.all([
    import("../../db/v2/client"), import("../../db/v2/schema"), import("../../db/v2/services/spaquatoriaPromoCodes"),
  ]);
  const identity = (await v2Pool.query<{ database: string; role: string; address: string | null; version: string; count: number; latest: string }>(
    `SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS address,
      current_setting('server_version_num') AS version,(SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS count,
      (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest`,
  )).rows[0];
  const address = identity?.address?.split("/")[0] ?? "";
  if (!identity || identity.database !== "soundspa_v2" || identity.role !== role || !identity.version.startsWith("16") ||
      isIP(address) === 0 || !new Set(["127.0.0.1", "::1"]).has(address) || identity.count !== 24 || identity.latest !== "1792039656234") {
    throw new Error("Refusing Spaquatoria promo integration test: expected isolated PostgreSQL 16 at migration 0023.");
  }
  const clean = await v2Pool.query<{ total: string }>(`SELECT
    (SELECT count(*) FROM organizations)+(SELECT count(*) FROM users)+(SELECT count(*) FROM locations)+
    (SELECT count(*) FROM commercial_products)+(SELECT count(*) FROM commercial_partners)+
    (SELECT count(*) FROM commercial_spaquatoria_promo_codes)+(SELECT count(*) FROM commercial_spaquatoria_promo_code_events)+
    (SELECT count(*) FROM commercial_spaquatoria_promo_redemptions)+(SELECT count(*) FROM commercial_partner_benefits)+
    (SELECT count(*) FROM commercial_billing_orders)+(SELECT count(*) FROM commercial_payments)+
    (SELECT count(*) FROM location_subscriptions)+(SELECT count(*) FROM location_core_trials) AS total`);
  if (clean.rows[0]?.total !== "0") throw new Error("Disposable Spaquatoria promo database must start without application or billing fixtures; discard it after this test.");

  let assertions = 0;
  const check = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };
  const rejectsCode = async (operation: Promise<unknown>, code: string) => {
    await assert.rejects(operation, (error: unknown) => error && typeof error === "object" && "code" in error && error.code === code);
    assertions++;
  };
  const now = new Date();
  const day = 86_400_000;
  const suffix = randomUUID();
  try {
    const [partner] = await v2Db.insert(schema.commercialPartners).values({ code: "spaquatoria", name: "Spaquatoria", isActive: true }).returning();
    const [product] = await v2Db.insert(schema.commercialProducts).values({ code: "spaquatoria", name: "Spaquatoria", kind: "partner", isActive: true, visibility: "private" }).returning();
    const [owner, otherOwner, manager] = await v2Db.insert(schema.users).values([
      { email: `spa-promo-owner-${suffix}@example.invalid`, emailVerifiedAt: now },
      { email: `spa-promo-other-${suffix}@example.invalid`, emailVerifiedAt: now },
      { email: `spa-promo-manager-${suffix}@example.invalid`, emailVerifiedAt: now },
    ]).returning();
    const [org, otherOrg] = await v2Db.insert(schema.organizations).values([{ name: `Promo Org ${suffix}` }, { name: `Promo Other ${suffix}` }]).returning();
    await v2Db.insert(schema.organizationMembers).values([
      { organizationId: org.id, userId: owner.id, role: "owner" },
      { organizationId: org.id, userId: manager.id, role: "manager" },
      { organizationId: otherOrg.id, userId: otherOwner.id, role: "owner" },
    ]);
    const locationRows = await v2Db.insert(schema.locations).values(Array.from({ length: 8 }, (_, index) => ({
      organizationId: index === 7 ? otherOrg.id : org.id, name: `Promo Location ${index + 1}`, slug: `spa-promo-${suffix.slice(0, 10)}-${index + 1}`, timezone: "UTC",
    }))).returning();
    const location = (index: number) => locationRows[index]!;
    const createCode = (options: { durationDays?: number; maxRedemptions?: number | null; expiresAt?: Date | null } = {}) =>
      promoService.createSpaquatoriaPromoCode({ durationDays: options.durationDays ?? 30, expiresAt: options.expiresAt ?? null,
        maxRedemptions: options.maxRedemptions ?? null, reason: "Disposable promo integration scenario" }, now);

    const basic = await createCode({ maxRedemptions: 1 });
    const stored = (await v2Db.select().from(schema.commercialSpaquatoriaPromoCodes).where((await import("drizzle-orm")).eq(schema.commercialSpaquatoriaPromoCodes.id, basic.promoCode.id)))[0]!;
    check(stored.tokenHash, createHash("sha256").update(basic.code).digest("hex"), "only SHA-256 token hash is stored");
    const listing = JSON.stringify(await promoService.listSpaquatoriaPromoCodes(now));
    check(listing.includes(basic.promoCode.id), true, "operator listing returns issued code metadata");
    check(listing.includes(basic.code), false, "operator listing never returns raw token");
    const createdEvent = (await v2Db.select().from(schema.commercialSpaquatoriaPromoCodeEvents).where((await import("drizzle-orm")).eq(schema.commercialSpaquatoriaPromoCodeEvents.promoCodeId, basic.promoCode.id)))[0]!;
    check([createdEvent.action, createdEvent.operator, createdEvent.reason], ["created", process.env.V2_ADMIN_USERNAME, "Disposable promo integration scenario"], "creation audit records trusted operator and reason");
    check(JSON.stringify(createdEvent).includes(basic.code), false, "raw token is absent from audit events");
    await assert.rejects(v2Pool.query("UPDATE commercial_spaquatoria_promo_code_events SET reason='rewritten audit' WHERE id=$1", [createdEvent.id]), /append-only/);
    assertions++;
    const redeemed = await promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(0).id, code: basic.code }, now);
    check(redeemed.status, "redeemed", "verified Owner redeems without Basic purchase or grant");
    if (redeemed.status !== "redeemed") throw new Error("Expected promo redemption.");
    check(redeemed.periods, [{ startsAt: now, endsAt: new Date(now.getTime() + 30 * day) }], "finite benefit starts at redemption time for 30 elapsed days");
    const benefit = (await v2Db.select().from(schema.commercialPartnerBenefits).where((await import("drizzle-orm")).eq(schema.commercialPartnerBenefits.promoRedemptionId, redeemed.redemptionId)))[0]!;
    check([benefit.partnerId, benefit.productId, benefit.locationId, benefit.endsAt?.getTime()], [partner.id, product.id, location(0).id, now.getTime() + 30 * day], "benefit is scoped to Spaquatoria Product and selected Location");
    check(benefit.promoRedemptionId, redeemed.redemptionId, "created Partner Benefit links to its redemption audit record");
    const replay = await promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(0).id, code: basic.code }, new Date(now.getTime() + 1));
    check(replay.status, "already_redeemed", "same shared code cannot be redeemed twice for one Location");
    await rejectsCode(promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(1).id, code: basic.code }, now), "promo_unavailable");

    const shared = await createCode({ durationDays: 60 });
    const multiLocation = await Promise.all([1, 2].map((index) => promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(index).id, code: shared.code }, now)));
    check(multiLocation.map((item) => item.status), ["redeemed", "redeemed"], "shared unlimited code redeems across separate Locations");
    await rejectsCode(promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: manager.id, locationId: location(3).id, code: shared.code }, now), "not_authorized");
    await rejectsCode(promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: otherOwner.id, locationId: location(0).id, code: shared.code }, now), "not_authorized");

    const activePermanentCode = await createCode({ maxRedemptions: 1 });
    await v2Db.insert(schema.commercialPartnerBenefits).values({ partnerId: partner.id, productId: product.id, locationId: location(3).id,
      startsAt: new Date(now.getTime() - day), endsAt: null });
    check((await promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(3).id, code: activePermanentCode.code }, now)).status,
      "already_covered", "active indefinite benefit is preserved and consumes no redemption");
    check((await v2Db.select().from(schema.commercialSpaquatoriaPromoRedemptions).where((await import("drizzle-orm")).eq(schema.commercialSpaquatoriaPromoRedemptions.promoCodeId, activePermanentCode.promoCode.id))).length,
      0, "already-covered Location has no redemption row");
    const preservedPermanent = (await v2Db.select().from(schema.commercialPartnerBenefits).where((await import("drizzle-orm")).eq(schema.commercialPartnerBenefits.locationId, location(3).id)))[0]!;
    check([preservedPermanent.startsAt.getTime(), preservedPermanent.endsAt], [now.getTime() - day, null], "existing indefinite Partner Benefit remains unchanged");

    const futurePermanentCode = await createCode({ durationDays: 30 });
    await v2Db.insert(schema.commercialPartnerBenefits).values([
      { partnerId: partner.id, productId: product.id, locationId: location(4).id, startsAt: new Date(now.getTime() + 50 * day), endsAt: null },
      { partnerId: partner.id, productId: product.id, locationId: location(4).id, startsAt: new Date(now.getTime() + 10 * day), endsAt: new Date(now.getTime() + 25 * day) },
      { partnerId: partner.id, productId: product.id, locationId: location(4).id, startsAt: new Date(now.getTime() + 20 * day), endsAt: new Date(now.getTime() + 30 * day) },
    ]);
    const beforeFutureRows = (await v2Db.select().from(schema.commercialPartnerBenefits).where((await import("drizzle-orm")).eq(schema.commercialPartnerBenefits.locationId, location(4).id))).map((item) => [item.startsAt.getTime(), item.endsAt?.getTime() ?? null]);
    const futurePlan = await promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(4).id, code: futurePermanentCode.code }, now);
    check(futurePlan.status, "redeemed", "future indefinite benefit leaves promo coverage for gaps before it");
    if (futurePlan.status !== "redeemed") throw new Error("Expected finite promo segments before future indefinite benefit.");
    check(futurePlan.grantedDurationMs, 30 * day, "overlapping finite periods do not reduce requested grant duration");
    check(futurePlan.periods.map((period) => [period.startsAt.getTime(), period.endsAt.getTime()]), [
      [now.getTime(), now.getTime() + 10 * day], [now.getTime() + 30 * day, now.getTime() + 50 * day],
    ], "future permanent start caps new coverage and overlaps are not duplicated");
    const afterFutureRows = (await v2Db.select().from(schema.commercialPartnerBenefits).where((await import("drizzle-orm")).eq(schema.commercialPartnerBenefits.locationId, location(4).id))).filter((item) => !item.promoRedemptionId).map((item) => [item.startsAt.getTime(), item.endsAt?.getTime() ?? null]);
    check(afterFutureRows, beforeFutureRows, "historical finite and indefinite benefit records remain unchanged");

    const noGapCode = await createCode({ durationDays: 30, maxRedemptions: 1 });
    await v2Db.insert(schema.commercialPartnerBenefits).values([
      { partnerId: partner.id, productId: product.id, locationId: location(5).id, startsAt: now, endsAt: new Date(now.getTime() + 10 * day) },
      { partnerId: partner.id, productId: product.id, locationId: location(5).id, startsAt: new Date(now.getTime() + 10 * day), endsAt: null },
    ]);
    check((await promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(5).id, code: noGapCode.code }, now)).status,
      "already_covered", "continuous finite coverage to future indefinite access does not consume code");

    const expiredHash = createHash("sha256").update(`expired-${suffix}`).digest("hex");
    const [expired] = await v2Db.insert(schema.commercialSpaquatoriaPromoCodes).values({ partnerId: partner.id, productId: product.id, tokenHash: expiredHash,
      durationDays: 30, createdByOperator: process.env.V2_ADMIN_USERNAME!, creationReason: "Disposable expired fixture reason", createdAt: new Date(now.getTime() - 2 * day), expiresAt: new Date(now.getTime() - day) }).returning();
    void expired;
    await rejectsCode(promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(6).id, code: `expired-${suffix}` }, now), "promo_unavailable");

    const revocable = await createCode();
    const configured = await promoService.configureSpaquatoriaPromoCode(revocable.promoCode.id, { confirm: true, durationDays: 90, expiresAt: null, maxRedemptions: 2, reason: "Configure future promo redemptions" }, now);
    check(configured.changed, true, "configuration changes create an operator audit event");
    await promoService.revokeSpaquatoriaPromoCode(revocable.promoCode.id, { confirm: true, reason: "End this disposable promo campaign" }, new Date(now.getTime() + 1));
    await rejectsCode(promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(6).id, code: revocable.code }, now), "promo_unavailable");
    const history = await v2Db.select().from(schema.commercialSpaquatoriaPromoCodeEvents).where((await import("drizzle-orm")).eq(schema.commercialSpaquatoriaPromoCodeEvents.promoCodeId, revocable.promoCode.id));
    check(history.map((item) => item.action), ["created", "configured", "revoked"], "operator actions are recorded in append-only history");

    const triggerSuffix = suffix.replaceAll("-", "");
    await v2Pool.query(`CREATE FUNCTION public.spa_promo_fail_event_${triggerSuffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional promo audit rollback'; END; $$`);
    await v2Pool.query(`CREATE TRIGGER spa_promo_fail_event_${triggerSuffix} BEFORE INSERT ON commercial_spaquatoria_promo_code_events FOR EACH ROW WHEN (NEW.action = 'created') EXECUTE FUNCTION public.spa_promo_fail_event_${triggerSuffix}()`);
    const beforeFailedCreate = await v2Pool.query<{ count: string }>("SELECT count(*)::text AS count FROM commercial_spaquatoria_promo_codes");
    await assert.rejects(createCode());
    assertions++;
    check((await v2Pool.query<{ count: string }>("SELECT count(*)::text AS count FROM commercial_spaquatoria_promo_codes")).rows[0]?.count,
      beforeFailedCreate.rows[0]?.count, "failed operator audit insertion rolls back promo code creation");
    await v2Pool.query(`DROP TRIGGER spa_promo_fail_event_${triggerSuffix} ON commercial_spaquatoria_promo_code_events`);
    await v2Pool.query(`DROP FUNCTION public.spa_promo_fail_event_${triggerSuffix}()`);

    const rollbackCode = await createCode();
    await v2Pool.query(`CREATE FUNCTION public.spa_promo_fail_benefit_${triggerSuffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.promo_redemption_id IS NOT NULL THEN RAISE EXCEPTION 'intentional promo benefit rollback'; END IF; RETURN NEW; END; $$`);
    await v2Pool.query(`CREATE TRIGGER spa_promo_fail_benefit_${triggerSuffix} BEFORE INSERT ON commercial_partner_benefits FOR EACH ROW EXECUTE FUNCTION public.spa_promo_fail_benefit_${triggerSuffix}()`);
    await assert.rejects(promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(6).id, code: rollbackCode.code }, now));
    assertions++;
    check((await v2Pool.query<{ count: string }>("SELECT count(*)::text AS count FROM commercial_spaquatoria_promo_redemptions WHERE promo_code_id=$1", [rollbackCode.promoCode.id])).rows[0]?.count,
      "0", "failure after inserting redemption leaves no consumed code record");
    await v2Pool.query(`DROP TRIGGER spa_promo_fail_benefit_${triggerSuffix} ON commercial_partner_benefits`);
    await v2Pool.query(`DROP FUNCTION public.spa_promo_fail_benefit_${triggerSuffix}()`);

    const concurrent = await createCode({ maxRedemptions: 1 });
    const contenders = await Promise.allSettled([location(6).id, location(7).id].map((locationId, index) => promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: index === 0 ? owner.id : otherOwner.id, locationId, code: concurrent.code }, now)));
    check(contenders.filter((item) => item.status === "fulfilled" && item.value.status === "redeemed").length, 1, "concurrent shared-code redemptions consume at most one redemption");
    check(contenders.filter((item) => item.status === "rejected" && item.reason?.code === "promo_unavailable").length, 1, "losing concurrent redemption observes exhausted code");

    const sameLocationCode = await createCode();
    const sameLocationAttempts = await Promise.all([0, 1].map(() => promoService.redeemSpaquatoriaPromoCode({ authenticatedUserId: owner.id, locationId: location(6).id, code: sameLocationCode.code }, new Date(now.getTime() + 2))));
    check(sameLocationAttempts.map((item) => item.status).sort(), ["already_redeemed", "redeemed"], "concurrent same-code redemption at one Location produces one grant and an idempotent repeat");

    const distinctCodes = await Promise.all([createCode(), createCode()]);
    const distinctCodeResults = await Promise.all(distinctCodes.map((promo, index) => promoService.redeemSpaquatoriaPromoCode({
      authenticatedUserId: owner.id, locationId: location(6).id, code: promo.code,
    }, new Date(now.getTime() + 3 + index))));
    check(distinctCodeResults.map((item) => item.status), ["redeemed", "redeemed"], "different codes can be redeemed concurrently for one Location");
    const distinctPeriods = distinctCodeResults.flatMap((item) => item.status === "redeemed" ? item.periods : [])
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    check(distinctPeriods.length, 2, "both distinct-code redemptions create one finite period");
    check(distinctPeriods.every((period) => period.endsAt.getTime() - period.startsAt.getTime() === 30 * day), true,
      "concurrent distinct codes preserve the full requested duration");
    check(distinctPeriods[0]!.endsAt.getTime() <= distinctPeriods[1]!.startsAt.getTime(), true,
      "concurrent distinct codes append without overlap or lost days");

    const totals = await v2Pool.query<{ orders: string; payments: string; subscriptions: string; trials: string }>(
      "SELECT (SELECT count(*) FROM commercial_billing_orders)::text AS orders,(SELECT count(*) FROM commercial_payments)::text AS payments,(SELECT count(*) FROM location_subscriptions)::text AS subscriptions,(SELECT count(*) FROM location_core_trials)::text AS trials",
    );
    check(totals.rows[0], { orders: "0", payments: "0", subscriptions: "0", trials: "0" }, "promo redemption creates no order, payment, paid subscription, or trial");
    console.info(`Spaquatoria promo PostgreSQL integration PASS (${assertions} assertions). Database contains disposable fixtures and must be discarded after the run.`);
  } finally {
    await v2Pool.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Spaquatoria promo integration failed."); process.exitCode = 1; });
