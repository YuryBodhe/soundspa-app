import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID, createHash } from "node:crypto";

const databaseUrl = process.env.V2_DATABASE_URL;
const testPort = process.env.V2_PROMOTIONAL_ACCESS_TEST_PORT;
if (process.env.V2_PROMOTIONAL_ACCESS_TEST_ALLOW_DATABASE !== "1" || !databaseUrl || !testPort) {
  throw new Error("Refusing Promotional Access integration test: explicit disposable-loopback opt-in, port, and V2_DATABASE_URL are required.");
}
const target = new URL(databaseUrl);
const role = decodeURIComponent(target.username);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname) ||
    decodeURIComponent(target.pathname) !== "/soundspa_v2" || target.port !== testPort ||
    new Set(["soundspa_v2", "postgres", "root"]).has(role)) {
  throw new Error("Refusing Promotional Access integration test: only the explicitly configured isolated PostgreSQL 16 loopback database is allowed.");
}
process.env.V2_DATABASE_URL = databaseUrl;
let closePool: (() => Promise<void>) | undefined;

async function main() {
  const [{ v2Db, v2Pool }, { migrate }] = await Promise.all([
    import("../../db/v2/client"), import("drizzle-orm/node-postgres/migrator"),
  ]);
  closePool = () => v2Pool.end();
  const identityResult = await v2Pool.query<{ database: string; role: string; address: string | null; version: string; port: number; migrations: string; latest: string; basicProductId: string | null; trialTableExists: boolean; promoTableExists: boolean }>(`SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS address,
    current_setting('server_version_num') AS version,inet_server_port() AS port,
    (SELECT count(*)::text FROM drizzle_v2.__drizzle_migrations) AS migrations,
    (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest,
    (SELECT id::text FROM commercial_products WHERE code='soundspa' LIMIT 1) AS "basicProductId",
    to_regclass('public.organization_core_trials') IS NOT NULL AS "trialTableExists",
    to_regclass('commercial_promotional_access.location_product_promotional_access') IS NOT NULL AS "promoTableExists"`);
  const identity = identityResult.rows[0];
  const address = identity?.address?.split("/")[0] ?? "";
  if (!identity || identity.database !== "soundspa_v2" || identity.role !== role || !identity.version.startsWith("16") ||
      isIP(address) === 0 || !new Set(["127.0.0.1", "::1"]).has(address) || String(identity.port) !== testPort ||
      identity.migrations !== "35" || identity.latest !== "1794131239809" || !identity.trialTableExists ||
      identity.promoTableExists || !identity.basicProductId) {
    throw new Error("Refusing Promotional Access integration test: expected isolated PostgreSQL 16 V2 backup at migration 0034 with no Promotional Access schema.");
  }
  const foreignKeysBefore = (await v2Pool.query<{ name: string }>(`SELECT conrelid::regclass::text||chr(58)||conname AS name FROM pg_constraint WHERE contype='f' ORDER BY name`)).rows.map((row) => row.name);

  const e2e = await v2Pool.query<{ organizationId: string; locationId: string; trialId: string; startsAt: string; endsAt: string; slots: number; devices: string[]; legacyTrialId: string; legacyStartsAt: string; legacyEndsAt: string; legacyStatus: string }>(`SELECT o.id AS "organizationId",l.id AS "locationId",t.id AS "trialId",
      to_char(t.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "startsAt",
      to_char(t.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "endsAt",
      (SELECT count(*)::int FROM organization_core_trial_locations a WHERE a.organization_trial_id=t.id) AS slots,
      (SELECT array_agg(d.id::text ORDER BY d.id) FROM devices d WHERE d.location_id=l.id AND d.status='active' AND d.revoked_at IS NULL) AS devices,
      legacy.id AS "legacyTrialId",to_char(legacy.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "legacyStartsAt",
      to_char(legacy.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "legacyEndsAt",legacy.status::text AS "legacyStatus"
    FROM organizations o JOIN locations l ON l.organization_id=o.id
    JOIN organization_core_trials t ON t.organization_id=o.id AND t.product_id=$1
    LEFT JOIN location_core_trials legacy ON legacy.location_id=l.id AND legacy.product_id=t.product_id AND legacy.invalidated_by_reset_id IS NULL
    WHERE o.name='SoundSpa E2E Test 01' AND l.name='Salon E2E Test 01'`, [identity.basicProductId]);
  const e2eBefore = e2e.rows[0];
  assert(e2eBefore, "Expected E2E Organization Trial fixture in fresh staging backup.");
  assert.equal(e2eBefore.startsAt, "2026-11-08 05:40:47.733");
  assert.equal(e2eBefore.endsAt, "2026-12-06 05:40:47.733");
  assert.equal(e2eBefore.slots, 2);
  assert.equal(e2eBefore.devices?.length, 1);
  assert.ok(e2eBefore.legacyTrialId, "Expected the original Location-scoped E2E trial to remain present.");
  assert.ok(e2eBefore.legacyEndsAt, "Expected the original Location-scoped E2E trial end date.");

  await migrate(v2Db, { migrationsFolder: "drizzle/v2", migrationsSchema: "drizzle_v2", migrationsTable: "__drizzle_migrations" });
  const postMigration = await v2Pool.query<{ migrations: string; latest: string }>(`SELECT count(*)::text AS migrations,max(created_at)::text AS latest FROM drizzle_v2.__drizzle_migrations`);
  assert.deepEqual(postMigration.rows[0], { migrations: "36", latest: "1794145936847" });
  const foreignKeysAfter = (await v2Pool.query<{ name: string }>(`SELECT conrelid::regclass::text||chr(58)||conname AS name FROM pg_constraint WHERE contype='f' ORDER BY name`)).rows.map((row) => row.name);
  assert.equal(foreignKeysAfter.length, foreignKeysBefore.length + 5, "migration adds only the five required Promotional Access foreign keys");
  assert.ok(foreignKeysBefore.every((name) => foreignKeysAfter.includes(name)), "existing foreign-key constraints remain intact");
  const protection = await v2Pool.query<{ tables: number; foreignKeys: number; triggers: number; enabledTriggers: number }>(`SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='commercial_promotional_access' AND table_type='BASE TABLE') AS tables,
      (SELECT count(*)::int FROM pg_constraint WHERE connamespace='commercial_promotional_access'::regnamespace AND contype='f') AS "foreignKeys",
      (SELECT count(*)::int FROM pg_trigger WHERE tgrelid IN ('commercial_promotional_access.location_product_promotional_access'::regclass,'commercial_promotional_access.location_product_promotional_access_events'::regclass) AND NOT tgisinternal) AS triggers,
      (SELECT count(*)::int FROM pg_trigger WHERE tgrelid IN ('commercial_promotional_access.location_product_promotional_access'::regclass,'commercial_promotional_access.location_product_promotional_access_events'::regclass) AND NOT tgisinternal AND tgenabled='O') AS "enabledTriggers"`);
  assert.deepEqual(protection.rows[0], { tables: 2, foreignKeys: 5, triggers: 5, enabledTriggers: 5 });

  const suffix = randomUUID();
  const now = new Date("2026-11-08T12:00:00.000Z");
  const endsAt = new Date("2026-12-06T05:40:47.733Z");
  const createFixtureLocation = async (name: string) => {
    const org = (await v2Pool.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [`promo-test-${suffix}-${name}`])).rows[0]!.id;
    const location = (await v2Pool.query<{ id: string }>(`INSERT INTO locations (organization_id,name,slug,timezone)
      VALUES ($1,$2,$3,'UTC') RETURNING id`, [org, name, `promo-${suffix.slice(0,8)}-${name.toLowerCase()}`])).rows[0]!.id;
    return { organizationId: org, locationId: location };
  };
  const first = await createFixtureLocation("trial-window");
  const second = await createFixtureLocation("parallel-requests");
  const third = await createFixtureLocation("paid-conflict");
  const fourth = await createFixtureLocation("registration-source");
  const fifth = await createFixtureLocation("partner-source");
  const sixth = await createFixtureLocation("preview-confirmation");
  const seventh = await createFixtureLocation("stale-preview");

  await v2Pool.query(`INSERT INTO organization_core_trials (organization_id,product_id,status,starts_at,ends_at,origin)
    VALUES ($1,$2,'active',$3,$4,'first_location_creation')`, [first.organizationId, identity.basicProductId, new Date(now.getTime()-86_400_000), endsAt]);
  const trialId = (await v2Pool.query<{ id: string }>(`SELECT id FROM organization_core_trials WHERE organization_id=$1`, [first.organizationId])).rows[0]!.id;
  await v2Pool.query(`INSERT INTO organization_core_trial_locations (organization_trial_id,organization_id,location_id,slot_number,source,allocated_at)
    VALUES ($1,$2,$3,1,'first_location_creation',$4)`, [trialId, first.organizationId, first.locationId, new Date(now.getTime()-86_400_000)]);

  const { previewManualPromotionalAccess, createManualPromotionalAccess, createRegistrationLinkPromotionalAccess,
    createPartnerInvitePromotionalAccess, revokeLocationPromotionalAccess, PromotionalAccessError } = await import("../../db/v2/services/promotionalAccess");
  const operator = "isolated-promo-operator";
  const manualInput = (locationId: string, productId: string, requestId: string, durationValue = 1) => ({
    locationId, productId, durationUnit: "calendar_months", durationValue,
    operator, reasonCode: "testing", reason: "Isolated Promotional Access integration fixture", requestId,
  });
  const preview = await previewManualPromotionalAccess(manualInput(first.locationId, identity.basicProductId!, randomUUID()), { now: () => now });
  assert.equal(preview.status, "preview");
  if (preview.status !== "preview") throw new Error("Expected initial manual grant preview.");
  assert.equal(preview.startsAt.toISOString(), endsAt.toISOString(), "Basic promotional access starts at the canonical trial end");
  assert.equal(preview.endsAt.toISOString(), "2027-01-06T05:40:47.733Z");
  const request1 = randomUUID();
  const firstInput = manualInput(first.locationId, identity.basicProductId, request1);
  const firstPreview = await previewManualPromotionalAccess(firstInput, { now: () => now });
  assert.equal(firstPreview.status, "preview");
  if (firstPreview.status !== "preview") throw new Error("Expected trial-boundary preview.");
  const firstGrant = await createManualPromotionalAccess({ ...firstInput, expectedStartsAt: firstPreview.startsAt.toISOString(), expectedEndsAt: firstPreview.endsAt.toISOString() }, { now: () => now });
  assert.equal(firstGrant.status, "granted");
  if (firstGrant.status !== "granted") throw new Error("Expected grant creation.");
  const retry = await createManualPromotionalAccess({ ...firstInput, expectedStartsAt: firstPreview.startsAt.toISOString(), expectedEndsAt: firstPreview.endsAt.toISOString() }, { now: () => now });
  assert.equal(retry.status, "already_granted");
  assert.equal(retry.grant.id, firstGrant.grant.id);

  const queuedInput = manualInput(first.locationId, identity.basicProductId, randomUUID(), 3);
  const queuedPreview = await previewManualPromotionalAccess(queuedInput, { now: () => now });
  assert.equal(queuedPreview.status, "preview");
  if (queuedPreview.status !== "preview") throw new Error("Expected queued grant preview.");
  assert.equal(queuedPreview.startsAt.toISOString(), firstGrant.grant.endsAt.toISOString());
  const queued = await createManualPromotionalAccess({ ...queuedInput, expectedStartsAt: queuedPreview.startsAt.toISOString(), expectedEndsAt: queuedPreview.endsAt.toISOString() }, { now: () => now });
  assert.equal(queued.status, "granted");
  const firstTrialAfterPromo = await v2Pool.query<{ endsAt: string; slots: number }>(`SELECT to_char(t.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "endsAt",
      (SELECT count(*)::int FROM organization_core_trial_locations l WHERE l.organization_trial_id=t.id) AS slots
    FROM organization_core_trials t WHERE t.organization_id=$1`, [first.organizationId]);
  assert.deepEqual(firstTrialAfterPromo.rows[0], { endsAt: "2026-12-06 05:40:47.733", slots: 1 }, "Basic Promotional Access must not mutate canonical trial dates or consume trial slots");

  const secondInput = manualInput(second.locationId, identity.basicProductId, randomUUID());
  const secondPreview = await previewManualPromotionalAccess(secondInput, { now: () => now });
  assert.equal(secondPreview.status, "preview");
  if (secondPreview.status !== "preview") throw new Error("Expected parallel request preview.");
  const secondCreate = { ...secondInput, expectedStartsAt: secondPreview.startsAt.toISOString(), expectedEndsAt: secondPreview.endsAt.toISOString() };
  const concurrent = await Promise.all([createManualPromotionalAccess(secondCreate, { now: () => now }), createManualPromotionalAccess(secondCreate, { now: () => now })]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), ["already_granted", "granted"]);
  assert.equal(concurrent[0]?.grant.id, concurrent[1]?.grant.id, "concurrent duplicate requests must resolve to one grant row");
  const raceInputs = [manualInput(second.locationId, identity.basicProductId, randomUUID()), manualInput(second.locationId, identity.basicProductId, randomUUID())];
  const racePreviews = await Promise.all(raceInputs.map((input) => previewManualPromotionalAccess(input, { now: () => now })));
  assert.ok(racePreviews.every((preview) => preview.status === "preview"));
  const raceCreates = await Promise.allSettled(raceInputs.map((input, index) => {
    const preview = racePreviews[index]!;
    if (preview.status !== "preview") throw new Error("Expected concurrent grant preview.");
    return createManualPromotionalAccess({ ...input, expectedStartsAt: preview.startsAt.toISOString(), expectedEndsAt: preview.endsAt.toISOString() }, { now: () => now });
  }));
  assert.equal(raceCreates.filter((result) => result.status === "fulfilled" && result.value.status === "granted").length, 1);
  assert.equal(raceCreates.filter((result) => result.status === "rejected" && result.reason instanceof PromotionalAccessError && result.reason.code === "schedule_changed").length, 1,
    "a stale concurrent preview must fail explicitly instead of overlapping or shifting silently");
  const secondRaceIndex = raceCreates.findIndex((result) => result.status === "rejected");
  const rescheduledInput = raceInputs[secondRaceIndex]!;
  const rescheduledPreview = await previewManualPromotionalAccess(rescheduledInput, { now: () => now });
  assert.equal(rescheduledPreview.status, "preview");
  if (rescheduledPreview.status !== "preview") throw new Error("Expected rescheduled grant preview.");
  const rescheduled = await createManualPromotionalAccess({ ...rescheduledInput, expectedStartsAt: rescheduledPreview.startsAt.toISOString(), expectedEndsAt: rescheduledPreview.endsAt.toISOString() }, { now: () => now });
  assert.equal(rescheduled.status, "granted");
  if (rescheduled.status !== "granted") throw new Error("Expected rescheduled grant.");
  const priorForRace = raceCreates.find((result) => result.status === "fulfilled" && result.value.status === "granted");
  if (priorForRace?.status !== "fulfilled" || priorForRace.value.status !== "granted") throw new Error("Expected first concurrent grant.");
  assert.equal(rescheduled.grant.startsAt.toISOString(), priorForRace.value.grant.endsAt.toISOString());
  const concurrentCount = await v2Pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM commercial_promotional_access.location_product_promotional_access WHERE location_id=$1 AND product_id=$2`, [second.locationId, identity.basicProductId]);
  assert.equal(concurrentCount.rows[0]?.count, "3", "same-key retries create one row and two different requests queue without overlap");

  const paidProvider = `promo-test-${suffix.slice(0,8)}`;
  await v2Pool.query(`INSERT INTO commercial_payment_providers (code,display_name,is_enabled) VALUES ($1,'Isolated test provider',false)`, [paidProvider]);
  await v2Pool.query(`INSERT INTO location_subscriptions (location_id,product_id,provider,status,starts_at,current_period_ends_at)
    VALUES ($1,$2,$3,'active',$4,$5)`, [third.locationId, identity.basicProductId, paidProvider, new Date(now.getTime()-60_000), new Date(now.getTime()+86_400_000)]);
  await assert.rejects(previewManualPromotionalAccess(manualInput(third.locationId, identity.basicProductId, randomUUID()), { now: () => now }),
    (error: unknown) => error instanceof PromotionalAccessError && error.code === "paid_coverage_conflict");

  const testProduct = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_products (code,name,kind,is_active,visibility,catalog_visibility)
    VALUES ($1,'Isolated promo product','core',true,'public','assigned') RETURNING id`, [`promo-test-${suffix.slice(0,8)}`])).rows[0]!.id;
  const productInput = manualInput(first.locationId, testProduct, randomUUID());
  const productPreview = await previewManualPromotionalAccess(productInput, { now: () => now });
  assert.equal(productPreview.status, "preview");
  if (productPreview.status !== "preview") throw new Error("Expected product-isolation preview.");
  assert.equal(productPreview.startsAt.toISOString(), now.toISOString(), "Basic trial scheduling must not delay another Product's access");

  const immediateInput = manualInput(sixth.locationId, identity.basicProductId, randomUUID());
  const immediatePreview = await previewManualPromotionalAccess(immediateInput, { now: () => now });
  assert.equal(immediatePreview.status, "preview");
  if (immediatePreview.status !== "preview") throw new Error("Expected immediate preview.");
  const confirmedPreview = await createManualPromotionalAccess({ ...immediateInput, expectedStartsAt: immediatePreview.startsAt.toISOString(), expectedEndsAt: immediatePreview.endsAt.toISOString() }, { now: () => new Date(now.getTime() + 2_000) });
  assert.equal(confirmedPreview.status, "granted");
  if (confirmedPreview.status !== "granted") throw new Error("Expected fresh immediate preview confirmation.");
  assert.equal(confirmedPreview.grant.startsAt.toISOString(), immediatePreview.startsAt.toISOString(), "a fresh preview confirmation preserves the reviewed exact start");
  assert.ok(confirmedPreview.grant.grantedAt > confirmedPreview.grant.startsAt);
  const staleInput = manualInput(seventh.locationId, identity.basicProductId, randomUUID());
  const stalePreview = await previewManualPromotionalAccess(staleInput, { now: () => now });
  assert.equal(stalePreview.status, "preview");
  if (stalePreview.status !== "preview") throw new Error("Expected stale-preview fixture.");
  await assert.rejects(createManualPromotionalAccess({ ...staleInput, expectedStartsAt: stalePreview.startsAt.toISOString(), expectedEndsAt: stalePreview.endsAt.toISOString() }, { now: () => new Date(now.getTime() + 6 * 60_000) }),
    (error: unknown) => error instanceof PromotionalAccessError && error.code === "schedule_changed");
  const staleRows = await v2Pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM commercial_promotional_access.location_product_promotional_access WHERE location_id=$1`, [seventh.locationId]);
  assert.equal(staleRows.rows[0]?.count, "0", "expired previews do not create grants");

  const registrationUser = (await v2Pool.query<{ id: string }>(`INSERT INTO users (email,email_verified_at) VALUES ($1,$2) RETURNING id`, [`promo-reg-${suffix}@example.invalid`, now])).rows[0]!.id;
  const regTokenHash = createHash("sha256").update(randomUUID()).digest("hex");
  const registrationLink = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_registration_links
    (token_hash,policy_key,policy_version,policy_snapshot,created_by_operator,creation_reason)
    VALUES ($1,'universal',1,$2::jsonb,'isolated-test','Isolated Promotional Access integration fixture') RETURNING id`, [regTokenHash, JSON.stringify({ policyKey: "universal", policyVersion: 1, products: [{ productId: identity.basicProductId, productCode: "soundspa", productName: "SoundSpa Basic", accessType: "trial", durationMonths: 3 }] })])).rows[0]!.id;
  const signupIntent = (await v2Pool.query<{ id: string }>(`INSERT INTO customer_signup_intents (email,registration_link_id,expires_at,verified_at)
    VALUES ($1,$2,$3,$4) RETURNING id`, [`promo-reg-${suffix}@example.invalid`, registrationLink, new Date(now.getTime()+86_400_000), now])).rows[0]!.id;
  const redemption = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_registration_link_redemptions
    (registration_link_id,signup_intent_id,verified_user_id,organization_id,first_location_id,product_id,redeemed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [registrationLink, signupIntent, registrationUser, fourth.organizationId, fourth.locationId, identity.basicProductId, now])).rows[0]!.id;
  const regGrantId = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_registration_link_grants
    (redemption_id,organization_id,location_id,product_id,access_type,duration_months,starts_at,ends_at)
    VALUES ($1,$2,$3,$4,'trial',3,$5,$6) RETURNING id`, [redemption, fourth.organizationId, fourth.locationId, identity.basicProductId, now, new Date("2027-02-08T12:00:00.000Z")])).rows[0]!.id;
  const regPromo = await createRegistrationLinkPromotionalAccess({ locationId: fourth.locationId, productId: identity.basicProductId, registrationLinkGrantId: regGrantId }, { now: () => now });
  assert.equal(regPromo.status, "granted");
  if (regPromo.status !== "granted") throw new Error("Expected Registration Link conversion.");
  assert.equal(regPromo.grant.durationUnit, "calendar_months");
  assert.equal(regPromo.grant.durationValue, 3);
  assert.equal(regPromo.grant.endsAt.toISOString(), "2027-02-08T12:00:00.000Z");
  assert.equal((await createRegistrationLinkPromotionalAccess({ locationId: fourth.locationId, productId: identity.basicProductId, registrationLinkGrantId: regGrantId }, { now: () => now })).status, "already_granted");
  await assert.rejects(v2Pool.query(`INSERT INTO commercial_promotional_access.location_product_promotional_access
    (location_id,product_id,source,registration_link_grant_id,duration_unit,duration_value,granted_at,starts_at,ends_at,reason_code,reason)
    VALUES ($1,$2,'registration_link',$3,'days',30,$4,$4,$5,'source_grant','Invalid provenance fixture')`,
  [fourth.locationId, identity.basicProductId, regGrantId, now, new Date(now.getTime() + 30 * 86_400_000)]),
  (error: unknown) => error instanceof Error && error.message.includes("Registration Link promotional provenance is invalid"));

  const partnerId = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_partners (code,name,is_active) VALUES ($1,'Isolated partner',true) RETURNING id`, [`promo-test-${suffix.slice(0,8)}`])).rows[0]!.id;
  const offerId = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_offers (partner_id,code,name,is_active) VALUES ($1,$2,'Isolated invite offer',true) RETURNING id`, [partnerId, `offer-${suffix.slice(0,8)}`])).rows[0]!.id;
  await v2Pool.query(`INSERT INTO commercial_offer_grants (offer_id,product_id,grant_type,duration_days) VALUES ($1,$2,'trial',30)`, [offerId, identity.basicProductId]);
  const invite = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_partner_invites (offer_id,token_hash,max_claims) VALUES ($1,$2,1) RETURNING id`, [offerId, createHash("sha256").update(randomUUID()).digest("hex")])).rows[0]!.id;
  const claim = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_partner_invite_claims (invite_id,location_id,claimed_at) VALUES ($1,$2,$3) RETURNING id`, [invite, fifth.locationId, now])).rows[0]!.id;
  const partnerPromo = await createPartnerInvitePromotionalAccess({ locationId: fifth.locationId, productId: identity.basicProductId, partnerInviteClaimId: claim }, { now: () => now });
  assert.equal(partnerPromo.status, "granted");
  if (partnerPromo.status !== "granted") throw new Error("Expected Partner Invite conversion.");
  assert.equal(partnerPromo.grant.durationUnit, "days");
  assert.equal(partnerPromo.grant.durationValue, 30);
  assert.equal(partnerPromo.grant.endsAt.toISOString(), "2026-12-08T12:00:00.000Z");
  await assert.rejects(v2Pool.query(`INSERT INTO commercial_promotional_access.location_product_promotional_access
    (location_id,product_id,source,partner_invite_claim_id,duration_unit,duration_value,granted_at,starts_at,ends_at,reason_code,reason)
    VALUES ($1,$2,'partner_invite',$3,'days',31,$4,$4,$5,'source_grant','Invalid provenance fixture')`,
  [fifth.locationId, identity.basicProductId, claim, now, new Date(now.getTime() + 31 * 86_400_000)]),
  (error: unknown) => error instanceof Error && error.message.includes("Partner Invite promotional provenance is invalid"));
  const spaquatoriaProduct = (await v2Pool.query<{ id: string }>(`SELECT id FROM commercial_products WHERE code='spaquatoria' LIMIT 1`)).rows[0];
  assert(spaquatoriaProduct, "Expected the independent Spaquatoria product in the restored catalog.");
  await assert.rejects(v2Pool.query(`INSERT INTO commercial_promotional_access.location_product_promotional_access
    (location_id,product_id,source,duration_unit,duration_value,granted_at,starts_at,ends_at,granted_by_operator,reason_code,reason,operator_request_id)
    VALUES ($1,$2,'operator','days',30,$3,$3,$4,'isolated-test','testing','Must stay a Partner Benefit',$5)`,
  [first.locationId, spaquatoriaProduct.id, now, new Date(now.getTime() + 30 * 86_400_000), randomUUID()]),
  (error: unknown) => error instanceof Error && error.message.includes("Spaquatoria Gift must remain a Partner Benefit"));

  const revoked = await revokeLocationPromotionalAccess({ id: firstGrant.grant.id, operator, reason: "Isolated test revocation" }, { now: () => now });
  assert.equal(revoked.status, "revoked");
  assert.equal((await revokeLocationPromotionalAccess({ id: firstGrant.grant.id, operator, reason: "Repeated test revocation" }, { now: () => now })).status, "already_revoked");
  const revokedRetry = await createManualPromotionalAccess({ ...firstInput, expectedStartsAt: firstGrant.grant.startsAt.toISOString(), expectedEndsAt: firstGrant.grant.endsAt.toISOString() }, { now: () => now });
  assert.equal(revokedRetry.status, "already_revoked", "retry must never recreate a revoked grant");
  const eventCount = await v2Pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM commercial_promotional_access.location_product_promotional_access_events WHERE promotional_access_id=$1`, [firstGrant.grant.id]);
  assert.equal(eventCount.rows[0]?.count, "2", "grant and revocation should each produce one audit event");
  await assert.rejects(v2Pool.query(`UPDATE commercial_promotional_access.location_product_promotional_access SET ends_at=ends_at+interval '1 day' WHERE id=$1`, [queued.status === "granted" ? queued.grant.id : firstGrant.grant.id]));
  await assert.rejects(v2Pool.query(`DELETE FROM commercial_promotional_access.location_product_promotional_access_events WHERE promotional_access_id=$1`, [firstGrant.grant.id]));

  const e2eAfter = await v2Pool.query<{ organizationId: string; locationId: string; trialId: string; startsAt: string; endsAt: string; slots: number; devices: string[]; legacyTrialId: string; legacyStartsAt: string; legacyEndsAt: string; legacyStatus: string }>(`SELECT o.id AS "organizationId",l.id AS "locationId",t.id AS "trialId",
      to_char(t.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "startsAt",to_char(t.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "endsAt",
      (SELECT count(*)::int FROM organization_core_trial_locations a WHERE a.organization_trial_id=t.id) AS slots,
      (SELECT array_agg(d.id::text ORDER BY d.id) FROM devices d WHERE d.location_id=l.id AND d.status='active' AND d.revoked_at IS NULL) AS devices,
      legacy.id AS "legacyTrialId",to_char(legacy.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "legacyStartsAt",
      to_char(legacy.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "legacyEndsAt",legacy.status::text AS "legacyStatus"
    FROM organizations o JOIN locations l ON l.organization_id=o.id JOIN organization_core_trials t ON t.organization_id=o.id AND t.product_id=$1
    LEFT JOIN location_core_trials legacy ON legacy.location_id=l.id AND legacy.product_id=t.product_id AND legacy.invalidated_by_reset_id IS NULL
    WHERE o.name='SoundSpa E2E Test 01' AND l.name='Salon E2E Test 01'`, [identity.basicProductId]);
  assert.deepEqual(e2eAfter.rows[0], e2eBefore, "migration and test fixtures must preserve exact E2E trial, slots, and active Device identity");

  console.log("PASS: migration 0035, E2E baseline preservation, calendar/day durations, trial scheduling, queues, idempotency, concurrent scheduling, paid conflict, source provenance, Spaquatoria separation, product/location isolation, revocation audit, immutability, and append-only audit triggers.");
  await v2Pool.end();
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : "Promotional Access isolated integration test failed.";
  console.error(message);
  await closePool?.().catch(() => undefined);
  process.exitCode = 1;
});
