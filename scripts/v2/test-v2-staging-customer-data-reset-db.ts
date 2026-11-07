import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { createProtectedPromoManifest, PROTECTED_PROMO_DISPOSAL, PROTECTED_PROMO_PARTNER_ID, PROTECTED_PROMO_PRODUCT_ID, readVerifiedProtectedPromoManifest, RESET_LOCATIONS, RESET_ORGANIZATIONS, runResetTransaction, StagingResetBlocked, writeProtectedPromoManifest } from "./reset-v2-staging-customer-data";

const url = process.env.V2_DATABASE_URL ?? "";
if (process.env.V2_STAGING_RESET_TEST !== "1") throw new Error("set V2_STAGING_RESET_TEST=1 to run disposable reset tests");
const parsed = new URL(url);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname) || parsed.port !== "55439" || decodeURIComponent(parsed.username) !== "soundspa_v2_reset_test" || parsed.pathname !== "/soundspa_v2") {
  throw new Error("reset integration tests require the dedicated loopback PostgreSQL 16 database on port 55439");
}

const mode = process.argv[2];
if (mode !== "--success" && mode !== "--protected-history" && mode !== "--scope-guards" && mode !== "--promo-unexpected-scope" && mode !== "--promo-unrevoked" && mode !== "--promo-definition-drift" && mode !== "--benefit-unexpected-scope" && mode !== "--revocation-guard-drift") throw new Error("expected a supported reset integration scenario");
const pool = new Pool({ connectionString: url, max: 1 });
let client: PoolClient;
const randomHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const id = () => randomUUID();
const count = async (sql: string, values: unknown[] = []) => Number((await client.query<{ n: string }>(sql, values)).rows[0]?.n ?? 0);

async function seed() {
  const products = new Map<string, string>();
  for (const [code, name, visibility, catalogVisibility] of [["soundspa", "SoundSpa Basic", "public", "public"], ["divnitsa", "Divnitsa", "private", "assigned"], ["spaquatoria", "Spaquatoria", "private", "assigned"]] as const) {
    const productId = code === "spaquatoria" ? PROTECTED_PROMO_PRODUCT_ID : id(); products.set(code, productId);
    await client.query("INSERT INTO commercial_products(id,code,name,kind,price_minor,currency,billing_interval_months,is_active,visibility,catalog_visibility) VALUES($1,$2,$3,$4,108000,'RUB',1,true,$5,$6)", [productId, code, name, code === "soundspa" ? "core" : "partner", visibility, catalogVisibility]);
  }

  const channels: string[] = [];
  for (let i = 0; i < 11; i++) {
    const channelId = id(); channels.push(channelId);
    await client.query("INSERT INTO channels(id,slug,display_name,kind,sort_order,is_published) VALUES($1,$2,$3,$4,$5,true)", [channelId, `reset-channel-${i + 1}`, `Reset Channel ${i + 1}`, "music", i]);
  }
  const basic = products.get("soundspa")!; const divnitsa = products.get("divnitsa")!; const spaquatoria = products.get("spaquatoria")!;
  for (const [productId, list] of [[basic, channels.slice(0, 9)], [divnitsa, [channels[9]]], [spaquatoria, [channels[10]]] ] as Array<[string, string[]]>) {
    for (const channelId of list) {
      await client.query("INSERT INTO commercial_product_channels(product_id,channel_id) VALUES($1,$2)", [productId, channelId]);
      await client.query("INSERT INTO base_channels(channel_id) VALUES($1)", [channelId]);
    }
  }
  for (let i = 0; i < 32; i++) await client.query("INSERT INTO channel_tracks(channel_id,storage_key,original_filename,size_bytes,sort_order) VALUES($1,$2,$3,1000,$4)", [channels[i % 11], `reset-fixture/${i}.mp3`, `track-${i}.mp3`, i]);

  const partner = PROTECTED_PROMO_PARTNER_ID; await client.query("INSERT INTO commercial_partners(id,code,name) VALUES($1,'reset-fixture','Reset Fixture Partner')", [partner]);
  const offer = id(); await client.query("INSERT INTO commercial_offers(id,partner_id,code,name) VALUES($1,$2,'reset-fixture','Reset Fixture Offer')", [offer, partner]);
  await client.query("INSERT INTO commercial_offer_grants(offer_id,product_id,grant_type,duration_days) VALUES($1,$2,'trial',30)", [offer, basic]);
  await client.query("INSERT INTO commercial_payment_providers(code,display_name,is_enabled) VALUES('fake-staging','Fake Staging',true) ON CONFLICT(code) DO NOTHING");
  const routeIds = new Map<string, string>();
  for (const productId of [basic, divnitsa, spaquatoria]) {
    const routeId = id(); routeIds.set(productId, routeId);
    await client.query("INSERT INTO commercial_payment_routes(id,market_code,product_id,provider_code,external_reference,is_enabled,display_order) VALUES($1,'RU',$2,'fake-staging',$3,true,0)", [routeId, productId, `reset-route-${productId}`]);
  }

  const registrationLink = id();
  const policy = { policyKey: "universal", policyVersion: 1, products: [{ productId: basic, productCode: "soundspa", productName: "SoundSpa Basic", accessType: "trial", durationMonths: 1 }] };
  await client.query("INSERT INTO commercial_registration_links(id,token_hash,policy_key,policy_version,policy_snapshot,created_by_operator,creation_reason,max_redemptions) VALUES($1,$2,'universal',1,$3::jsonb,'reset-test','fixture registration link',5)", [registrationLink, randomHash(), JSON.stringify(policy)]);

  const promoIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const expectedDisposal = PROTECTED_PROMO_DISPOSAL[i];
    const promoId = expectedDisposal?.promoCodeId ?? id(); promoIds.push(promoId);
    const expectedDefinition = i < 3;
    const archivedAt = i === 0 ? new Date("2026-10-28T14:12:31.535Z") : i === 1 ? new Date("2026-10-28T14:11:49.627Z") : i === 3 ? new Date() : null;
    const createdAt = i === 0 ? new Date("2026-10-16T07:25:27.487Z") : i === 1 ? new Date("2026-10-16T07:43:22.830Z") : i === 2 ? new Date("2026-10-16T07:35:13.980Z") : new Date(Date.now() - 60_000);
    const revokeCode = expectedDefinition && !(mode === "--promo-unrevoked" && i === 2);
    const revokedAt = revokeCode ? new Date(createdAt.getTime() + 1000) : null;
    await client.query("INSERT INTO commercial_spaquatoria_promo_codes(id,token_hash,partner_id,product_id,duration_days,created_by_operator,creation_reason,max_redemptions,created_at,archived_at,archived_by_operator,revoked_at,revoked_by_operator,revoke_reason) VALUES($1,$2,$3,$4,5,'reset-test','fixture promo code',1,$5,$6,$7,$8,$9,$10)", [promoId, randomHash(), partner, spaquatoria, createdAt, archivedAt, archivedAt ? "reset-test" : null, revokedAt, revokeCode ? "reset-test" : null, revokeCode ? "approved test credential revocation" : null]);
    const state = { redemptions: i === 0 ? 1 : 0, revokedAt: i >= 4 ? "fixture" : null };
    await client.query("INSERT INTO commercial_spaquatoria_promo_code_events(promo_code_id,action,operator,reason,after_state,created_at) VALUES($1,'created','reset-test','fixture promo created',$2::jsonb,$3)", [promoId, JSON.stringify(state), createdAt]);
    if (revokeCode) {
      await client.query("INSERT INTO commercial_spaquatoria_promo_code_events(promo_code_id,action,operator,reason,before_state,after_state,created_at) VALUES($1,'revoked','reset-test','approved test credential revocation',$2::jsonb,$3::jsonb,$4)", [promoId, JSON.stringify({ revokedAt: null }), JSON.stringify({ revokedAt: revokedAt!.toISOString() }), revokedAt]);
    }
  }

  const unlinkedUser = id();
  await client.query("INSERT INTO users(id,email,display_name,email_verified_at) VALUES($1,'preserved-user@reset.invalid','Preserved Unlinked User',now())", [unlinkedUser]);
  const orgUsers: string[] = [];
  const orgLocations: string[][] = [];
  for (let orgIndex = 0; orgIndex < RESET_ORGANIZATIONS.length; orgIndex++) {
    const [organizationId, organizationName] = RESET_ORGANIZATIONS[orgIndex];
    await client.query("INSERT INTO organizations(id,name,contact_email) VALUES($1,$2,$3)", [organizationId, organizationName, `contact-${orgIndex}@reset.invalid`]);
    const userId = id(); orgUsers.push(userId);
    const email = `owner-${orgIndex}@reset.invalid`;
    await client.query("INSERT INTO users(id,email,display_name,email_verified_at) VALUES($1,$2,$3,now())", [userId, email, `Reset owner ${orgIndex}`]);
    await client.query("INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'owner')", [organizationId, userId]);
    const locations: string[] = []; orgLocations.push(locations);
    const locationSpecs = RESET_LOCATIONS.filter(([, locationOrganization]) => locationOrganization === organizationId);
    for (let locationIndex = 0; locationIndex < locationSpecs.length; locationIndex++) {
      const [locationId, , locationName] = locationSpecs[locationIndex]!; locations.push(locationId);
      await client.query("INSERT INTO locations(id,organization_id,name,slug,timezone,market_code) VALUES($1,$2,$3,$4,'Asia/Ho_Chi_Minh','RU')", [locationId, organizationId, locationName, `reset-${orgIndex}-${locationIndex}`]);
    }
    const intentId = id();
    await client.query("INSERT INTO customer_signup_intents(id,email,locale,expires_at,verified_at,completed_at) VALUES($1,$2,'en',now()+interval '1 day',now(),now())", [intentId, email]);
    await client.query("INSERT INTO customer_auth_tokens(token_hash,purpose,user_id,locale,expires_at) VALUES($1,'login_link',$2,'en',now()+interval '1 day')", [randomHash(), userId]);
    if (orgIndex < 4) await client.query("INSERT INTO customer_auth_tokens(token_hash,purpose,signup_intent_id,locale,expires_at) VALUES($1,'verify_email',$2,'en',now()+interval '1 day')", [randomHash(), intentId]);
    for (let session = 0; session < (orgIndex < 4 ? 3 : 2); session++) await client.query("INSERT INTO customer_sessions(user_id,signup_intent_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [userId, intentId, randomHash()]);
  }
  for (let i = 0; i < PROTECTED_PROMO_DISPOSAL.length; i++) {
    const item = PROTECTED_PROMO_DISPOSAL[i]!;
    await client.query("INSERT INTO commercial_spaquatoria_promo_redemptions(id,promo_code_id,verified_user_id,organization_id,location_id,partner_id,product_id,requested_duration_days,granted_duration_ms,redeemed_at) VALUES($1,$2,$3,$4,$5,$6,$7,5,432000000,'2026-10-20T12:00:00Z')", [item.redemptionId,item.promoCodeId,orgUsers[0],item.organizationId,item.locationId,partner,spaquatoria]);
  }
  // One extra completed signup intent belongs to the linked owner but is otherwise unreferenced.
  await client.query("INSERT INTO customer_signup_intents(email,locale,expires_at,verified_at,completed_at) VALUES('owner-0@reset.invalid','ru',now()+interval '1 day',now(),now())");

  let deviceIndex = 0;
  const allDevices: Array<{ id: string; user: string; location: string }> = [];
  const devicesPerOrg = [6, 1, 1, 1, 2, 1];
  for (let orgIndex = 0; orgIndex < orgLocations.length; orgIndex++) {
    for (let j = 0; j < devicesPerOrg[orgIndex]!; j++) {
      const location = orgLocations[orgIndex]![j % orgLocations[orgIndex]!.length]!;
      const deviceId = id(); allDevices.push({ id: deviceId, user: orgUsers[orgIndex]!, location });
      await client.query("INSERT INTO devices(id,location_id,credential_hash,status,label) VALUES($1,$2,$3,'active',$4)", [deviceId, location, randomHash(), `Reset device ${deviceIndex++}`]);
      await client.query("INSERT INTO device_current_state(device_id,playback_state,ambient_playback_state) VALUES($1,'playing','idle')", [deviceId]);
      await client.query("INSERT INTO device_events(device_id,event_type) VALUES($1,'session_started')", [deviceId]);
      await client.query("INSERT INTO hourly_device_playback(bucket_start,device_id,active_playback_seconds) VALUES(date_trunc('hour',now()),$1,60)", [deviceId]);
      await client.query("INSERT INTO hourly_error_aggregates(bucket_start,category,error_code,device_id,event_count) VALUES(date_trunc('hour',now()),'PLAYBACK','TEST_ERROR',$1,1)", [deviceId]);
      await client.query("INSERT INTO monitoring_lifecycle_events(event_type,organization_id,organization_name,location_id,location_name,device_id,device_label) VALUES('device_created',$1,$2,$3,$4,$5,$6)", [RESET_ORGANIZATIONS[orgIndex]![0], RESET_ORGANIZATIONS[orgIndex]![1], location, `Reset Location ${orgIndex}`, deviceId, `Reset device ${deviceIndex}`]);
      if (deviceIndex <= 4) await client.query("INSERT INTO device_current_browser_operations(operation_hash,authenticated_user_id,location_id,device_id,created_at,expires_at) VALUES($1,$2,$3,$4,now()-interval '20 minutes',now()-interval '5 minutes')", [randomHash(), orgUsers[orgIndex]!, location, deviceId]);
    }
  }
  await client.query("INSERT INTO device_activation_tokens(device_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [allDevices[0]!.id, randomHash()]);
  for (let i = 0; i < 37; i++) await client.query("INSERT INTO hourly_channel_playback(bucket_start,device_id,channel_id,lane,played_seconds) VALUES(date_trunc('hour',now())-($1::int*interval '1 hour'),$2,$3,$4,30)", [Math.floor(i / 11), allDevices[i % allDevices.length]!.id, channels[i % channels.length]!, i % 2 === 0 ? "music" : "ambient"]);

  const trialLocations = orgLocations.map((x) => x[0]!);
  for (const location of trialLocations) await client.query("INSERT INTO location_core_trials(location_id,product_id,status,starts_at,ends_at) VALUES($1,$2,'active',now()-interval '1 day',now()+interval '29 days')", [location, basic]);
  const subscriptionLocations = [orgLocations[0]![0]!, orgLocations[0]![1]!, orgLocations[2]![0]!, orgLocations[2]![1]!, orgLocations[4]![0]!];
  const subscriptionIds: string[] = [];
  for (const location of subscriptionLocations) {
    const subId = id(); subscriptionIds.push(subId);
    await client.query("INSERT INTO location_subscriptions(id,location_id,product_id,provider,status,starts_at,current_period_ends_at,price_minor,currency) VALUES($1,$2,$3,'fake-staging','active',now()-interval '1 day',now()+interval '29 days',108000,'RUB')", [subId, location, basic]);
  }
  for (let i = 0; i < PROTECTED_PROMO_DISPOSAL.length; i++) {
    const item = PROTECTED_PROMO_DISPOSAL[i]!;
    await client.query("INSERT INTO commercial_partner_benefits(id,partner_id,product_id,location_id,starts_at,promo_redemption_id) VALUES($1,$2,$3,$4,'2026-10-20T12:00:00Z',$5)", [item.benefitId,partner,spaquatoria,item.locationId,item.redemptionId]);
  }

  const orderLocations = [orgLocations[0]![0]!, orgLocations[0]![1]!, orgLocations[2]![0]!, orgLocations[2]![1]!, orgLocations[4]![0]!, orgLocations[4]![0]!];
  for (let i = 0; i < 6; i++) {
    const orgIndex = i < 2 ? 0 : i < 4 ? 2 : 4;
    const productId = basic; const orderId = id(); const lineId = id(); const paymentId = id();
    const location = orderLocations[i]!; const routeId = routeIds.get(productId)!; const providerRef = `reset-route-${productId}`;
    await client.query("BEGIN");
    await client.query("INSERT INTO commercial_billing_orders(id,organization_id,created_by_user_id,status,provider_code,currency,total_amount_minor) VALUES($1,$2,$3,'paid','fake-staging','RUB',108000)", [orderId, RESET_ORGANIZATIONS[orgIndex]![0], orgUsers[orgIndex]!]);
    await client.query("INSERT INTO commercial_billing_order_lines(id,order_id,organization_id,location_id,product_id,provider_code,currency,market_code,route_id,route_external_reference,duration_months,list_amount_minor,discount_amount_minor,amount_minor,billing_anchor_day,billing_anchor_is_end_of_month) VALUES($1,$2,$3,$4,$5,'fake-staging','RUB','RU',$6,$7,1,108000,0,108000,1,false)", [lineId, orderId, RESET_ORGANIZATIONS[orgIndex]![0], location, productId, routeId, providerRef]);
    await client.query("INSERT INTO commercial_payments(id,billing_order_id,provider_code,payment_key,status,amount_minor,currency) VALUES($1,$2,'fake-staging',$3,'succeeded',108000,'RUB')", [paymentId, orderId, `reset-payment-${i}`]);
    await client.query("INSERT INTO commercial_payment_allocations(order_id,payment_id,order_line_id,amount_minor) VALUES($1,$2,$3,108000)", [orderId, paymentId, lineId]);
    await client.query("INSERT INTO commercial_payment_events(provider_code,payment_id,payment_key,idempotency_key,status,occurred_at) VALUES('fake-staging',$1,$2,$3,'succeeded',now())", [paymentId, `reset-payment-${i}`, `reset-event-${i}`]);
    await client.query("COMMIT");
  }

  const inviteId = id();
  await client.query("INSERT INTO commercial_partner_invites(id,offer_id,token_hash,max_claims) VALUES($1,$2,$3,1)", [inviteId, offer, randomHash()]);
  await client.query("INSERT INTO commercial_partner_invite_claims(invite_id,location_id) VALUES($1,$2)", [inviteId, orgLocations[0]![0]!]);

  await client.query("INSERT INTO organization_lifecycle_events(organization_id,organization_name,action,operator,reason) VALUES($1,'Historical Organization','archived','reset-test','historical immutable fixture event')", [id()]);

  if (mode === "--protected-history") {
    const owner = orgUsers[0]!; const organizationId = RESET_ORGANIZATIONS[0]![0]; const location = orgLocations[0]![0]!;
    const registrationIntent = id();
    await client.query("INSERT INTO customer_signup_intents(id,email,locale,expires_at,verified_at,completed_at,registration_link_id) VALUES($1,'owner-0@reset.invalid','en',now()+interval '1 day',now(),now(),$2)", [registrationIntent, registrationLink]);
    await client.query("INSERT INTO commercial_registration_link_redemptions(registration_link_id,signup_intent_id,verified_user_id,organization_id,first_location_id,product_id) VALUES($1,$2,$3,$4,$5,$6)", [registrationLink, registrationIntent, owner, organizationId, location, basic]);
  }
  return { channels, products, unlinkedUser, orgLocations, orderLocations, promoIds, orgUsers };
}

async function main() {
 client = await pool.connect();
 try {
  const identity = await client.query<{ version: string; database: string }>("SELECT current_setting('server_version_num') AS version,current_database() AS database");
  assert.ok(identity.rows[0]?.version.startsWith("16"), "test server must be PostgreSQL 16");
  assert.equal(identity.rows[0]?.database, "soundspa_v2");
  const fixture = await seed();
  const manifestDirectory = await mkdtemp(join(tmpdir(), "soundspa-reset-manifest-"));
  const makeManifest = async () => {
    const manifest = await createProtectedPromoManifest(client, "isolated-postgres-test");
    const path = join(manifestDirectory, "promo-history.json");
    const checksum = await writeProtectedPromoManifest(path, manifest, "test");
    const modeBits = (await stat(path)).mode & 0o777;
    assert.equal(modeBits, 0o600, "archive manifest must be owner-only");
    assert.doesNotMatch(JSON.stringify(manifest), /tokenHash|verifiedUserId|credentialHash|email/i, "manifest excludes tokens and personal identifiers");
    await assert.rejects(readVerifiedProtectedPromoManifest(path, "0".repeat(64), "test"), (error: unknown) => error instanceof StagingResetBlocked && error.code === "manifest_checksum_mismatch");
    return { manifest: await readVerifiedProtectedPromoManifest(path, checksum, "test"), path, checksum };
  };
  const beforeGlobal = {
    products: await count("SELECT count(*)::text AS n FROM commercial_products"),
    productChannels: await count("SELECT count(*)::text AS n FROM commercial_product_channels"),
    channels: await count("SELECT count(*)::text AS n FROM channels"),
    tracks: await count("SELECT count(*)::text AS n FROM channel_tracks"),
    registrations: await count("SELECT count(*)::text AS n FROM commercial_registration_links"),
    promos: await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_codes"),
  };
  const operator = "isolated-reset-test";
  if (mode === "--success") {
    const archive = await makeManifest();
    const dry = await runResetTransaction(client, { mode: "test", apply: false, operator, manifest: archive.manifest }, url);
    assert.equal(dry.result, "DRY_RUN_ROLLED_BACK");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 6, "dry-run must rollback the simulated deletions");
    const repeatedDry = await runResetTransaction(client, { mode: "test", apply: false, operator, manifest: archive.manifest }, url);
    assert.equal(repeatedDry.result, "DRY_RUN_ROLLED_BACK", "repeated dry-run must remain safe and stable");
    await assert.rejects(runResetTransaction(client, { mode: "test", apply: true, operator, manifest: archive.manifest, testFailureAfterTriggerDisable: true }, url), (error: unknown) => error instanceof StagingResetBlocked && error.code === "injected_test_failure_after_trigger_disable");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 6, "failure must rollback customer deletions");
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_redemptions"), 3, "failure must rollback protected-history deletion");
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_partner_benefits WHERE promo_redemption_id IS NOT NULL"), 3, "failure must rollback linked benefits");
    assert.deepEqual((await client.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='commercial_spaquatoria_promo_redemptions'::regclass AND NOT tgisinternal ORDER BY tgname")).rows, [
      { tgname: "commercial_spaquatoria_promo_redemptions_append_only", tgenabled: "O" },
      { tgname: "commercial_spaquatoria_promo_redemptions_no_truncate", tgenabled: "O" },
    ], "transaction rollback restores append-only trigger state");
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_codes WHERE id=ANY($1::uuid[]) AND revoked_at IS NOT NULL", [PROTECTED_PROMO_DISPOSAL.map((item) => item.promoCodeId)]), 3, "all consumed credentials remain irrevocably revoked");
    const applied = await runResetTransaction(client, { mode: "test", apply: true, operator, manifest: archive.manifest }, url);
    assert.equal(applied.result, "COMMITTED");
    assert.equal(applied.revokedPartnerInvites, 1);
    assert.equal(applied.retainedDeviceOperationTombstones, 4);
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM locations"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM devices"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM location_core_trials"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM location_subscriptions"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_billing_orders"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_payments"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_partner_benefits"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_redemptions"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_codes WHERE id=ANY($1::uuid[]) AND revoked_at IS NOT NULL", [PROTECTED_PROMO_DISPOSAL.map((item) => item.promoCodeId)]), 3, "definitions remain revoked after usage history removal");
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_code_events WHERE promo_code_id=ANY($1::uuid[]) AND action='revoked'", [PROTECTED_PROMO_DISPOSAL.map((item) => item.promoCodeId)]), 3, "revocation audit remains");
    assert.deepEqual((await client.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='commercial_spaquatoria_promo_redemptions'::regclass AND NOT tgisinternal ORDER BY tgname")).rows, [
      { tgname: "commercial_spaquatoria_promo_redemptions_append_only", tgenabled: "O" },
      { tgname: "commercial_spaquatoria_promo_redemptions_no_truncate", tgenabled: "O" },
    ]);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_partner_invite_claims"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM device_current_browser_operations"), 4);
    assert.equal(await count("SELECT count(*)::text AS n FROM device_current_browser_operations WHERE device_id IS NULL"), 4);
    assert.equal(await count("SELECT count(*)::text AS n FROM users"), 1);
    assert.equal(await count("SELECT count(*)::text AS n FROM users WHERE id=$1", [fixture.unlinkedUser]), 1);
    assert.equal(await count("SELECT count(*)::text AS n FROM device_events"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM monitoring_lifecycle_events"), 0);
    assert.equal(await count("SELECT count(*)::text AS n FROM organization_lifecycle_events"), 1);
    assert.deepEqual({
      products: await count("SELECT count(*)::text AS n FROM commercial_products"),
      productChannels: await count("SELECT count(*)::text AS n FROM commercial_product_channels"),
      channels: await count("SELECT count(*)::text AS n FROM channels"),
      tracks: await count("SELECT count(*)::text AS n FROM channel_tracks"),
      registrations: await count("SELECT count(*)::text AS n FROM commercial_registration_links"),
      promos: await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_codes"),
    }, beforeGlobal);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_partner_invites WHERE revoked_at IS NOT NULL"), 1, "claimed invitation must be revoked before its claim is removed");
  } else if (mode === "--protected-history") {
    const before = await count("SELECT count(*)::text AS n FROM organizations");
    const archive = await makeManifest();
    await assert.rejects(runResetTransaction(client, { mode: "test", apply: true, operator, manifest: archive.manifest }, url), (error: unknown) => {
      assert.ok(error instanceof StagingResetBlocked);
      assert.equal(error.code, "immutable_or_protected_history_present");
      assert.equal(error.counts.spaquatoria_redemptions, undefined, "the exact audited promo scope is permitted; the unrelated registration redemption remains blocking");
      assert.equal(error.counts.registration_redemptions, 1);
      return true;
    });
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), before);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_redemptions"), 3);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_registration_link_redemptions"), 1);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_partner_invite_claims"), 1, "no invite revocation/deletion should happen after protected-history preflight stops");
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_partner_invites WHERE revoked_at IS NOT NULL"), 0);
  } else if (mode === "--scope-guards") {
    const archive = await makeManifest();
    const outsideOrganization = id();
    await client.query("INSERT INTO organizations(id,name) VALUES($1,'Unexpected Organization')", [outsideOrganization]);
    await assert.rejects(runResetTransaction(client, { mode: "test", apply: true, operator, manifest: archive.manifest }, url), (error: unknown) => error instanceof StagingResetBlocked && error.code === "organization_allowlist_mismatch");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 7, "unexpected organization must block without deleting anything");
    await client.query("DELETE FROM organizations WHERE id=$1", [outsideOrganization]);
    await client.query("INSERT INTO locations(organization_id,name,slug,timezone,market_code) VALUES($1,'Unexpected Location','unexpected-location','UTC','RU')", [RESET_ORGANIZATIONS[0][0]]);
    await assert.rejects(runResetTransaction(client, { mode: "test", apply: true, operator, manifest: archive.manifest }, url), (error: unknown) => error instanceof StagingResetBlocked && error.code === "location_allowlist_mismatch");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 6);
    assert.equal(await count("SELECT count(*)::text AS n FROM locations"), 10, "unexpected Location must block without deleting anything");
  } else if (mode === "--promo-unexpected-scope") {
    const archive = await makeManifest();
    await client.query("INSERT INTO commercial_spaquatoria_promo_redemptions(id,promo_code_id,verified_user_id,organization_id,location_id,partner_id,product_id,requested_duration_days,granted_duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,5,432000000)", [id(), fixture.promoIds[3], fixture.orgUsers[0], RESET_ORGANIZATIONS[0][0], fixture.orgLocations[0][0], PROTECTED_PROMO_PARTNER_ID, PROTECTED_PROMO_PRODUCT_ID]);
    await assert.rejects(runResetTransaction(client, { mode: "test", apply: true, operator, manifest: archive.manifest }, url), (error: unknown) => error instanceof StagingResetBlocked && error.code === "protected_promo_scope_mismatch");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 6);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_redemptions"), 4);
    assert.deepEqual((await client.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='commercial_spaquatoria_promo_redemptions'::regclass AND NOT tgisinternal ORDER BY tgname")).rows, [
      { tgname: "commercial_spaquatoria_promo_redemptions_append_only", tgenabled: "O" },
      { tgname: "commercial_spaquatoria_promo_redemptions_no_truncate", tgenabled: "O" },
    ]);
  } else if (mode === "--benefit-unexpected-scope") {
    const archive = await makeManifest();
    await client.query("INSERT INTO commercial_partner_benefits(partner_id,product_id,location_id,starts_at) VALUES($1,$2,$3,now())", [PROTECTED_PROMO_PARTNER_ID, PROTECTED_PROMO_PRODUCT_ID, fixture.orgLocations[0]![0]!]);
    await assert.rejects(runResetTransaction(client, { mode: "test", apply: true, operator, manifest: archive.manifest }, url), (error: unknown) => error instanceof StagingResetBlocked && error.code === "partner_benefit_scope_mismatch");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 6);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_partner_benefits WHERE location_id IN ($1,$2,$3)", fixture.orgLocations[0]! ), 4);
  } else if (mode === "--promo-definition-drift") {
    await client.query("UPDATE commercial_spaquatoria_promo_codes SET duration_days=6 WHERE id=$1", [PROTECTED_PROMO_DISPOSAL[0]!.promoCodeId]);
    await assert.rejects(createProtectedPromoManifest(client, "isolated-postgres-test"), (error: unknown) => error instanceof StagingResetBlocked && error.code === "protected_promo_definition_drift");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 6);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_redemptions"), 3);
  } else if (mode === "--revocation-guard-drift") {
    await client.query("ALTER TABLE commercial_spaquatoria_promo_codes DISABLE TRIGGER commercial_spaquatoria_promo_codes_identity_immutable");
    await assert.rejects(createProtectedPromoManifest(client, "isolated-postgres-test"), (error: unknown) => error instanceof StagingResetBlocked && error.code === "protected_promo_revocation_guard_drift");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 6);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_redemptions"), 3);
  } else {
    assert.equal(mode, "--promo-unrevoked");
    await assert.rejects(createProtectedPromoManifest(client, "isolated-postgres-test"), (error: unknown) => error instanceof StagingResetBlocked && error.code === "protected_promo_revocation_not_audited");
    assert.equal(await count("SELECT count(*)::text AS n FROM organizations"), 6);
    assert.equal(await count("SELECT count(*)::text AS n FROM commercial_spaquatoria_promo_redemptions"), 3);
  }
  console.info(JSON.stringify({ result: "PASS", scenario: mode.slice(2), globalPreservationCounts: beforeGlobal }));
} finally {
  client.release();
  await pool.end();
}
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : "reset integration test failed");
  process.exitCode = 1;
});
