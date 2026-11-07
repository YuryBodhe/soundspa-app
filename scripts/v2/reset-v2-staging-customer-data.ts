import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";

/** Explicitly approved Organizations. Never replace this with a broad predicate. */
export const RESET_ORGANIZATIONS = [
  ["c3764e90-369b-4baf-84e2-4afd55efb925", "E2E Test Spa"],
  ["5acb734b-036d-4b14-871b-e995ad9aaf07", "Mercury Spa"],
  ["32f0db71-cb18-4e53-a8c5-2b8c848b09bb", "Moon Spa"],
  ["edc2d148-3d87-4354-a9a3-e285fcb4568c", "Sun Spa"],
  ["7aadcf0c-381e-4f6d-b07b-9a1f7135f0cc", "Test 05"],
  ["831231b5-ef74-4a57-907f-6cbd66b17244", "Test Salon 04"],
] as const;

/** Exact staging Locations verified read-only on 2026-11-07; names and ownership are all checked. */
export const RESET_LOCATIONS = [
  ["1e85000d-8b25-4d3e-ae11-a93d3b187fcd", RESET_ORGANIZATIONS[2][0], "Moon Spa West"],
  ["f86489a8-40aa-4514-9849-a551e647e031", RESET_ORGANIZATIONS[2][0], "Moon Spa East"],
  ["5ed85f42-1e7b-4a18-9ea2-a43facabff03", RESET_ORGANIZATIONS[1][0], "Mercury Spa"],
  ["b583647f-ee42-481c-83dc-8511cbe53208", RESET_ORGANIZATIONS[4][0], "Test 05"],
  ["a6d2380e-e20c-43c0-b4df-4a1800b7c984", RESET_ORGANIZATIONS[5][0], "Test Salon 04"],
  ["4ccefa19-69f5-4bf2-9001-f318fc9104ed", RESET_ORGANIZATIONS[0][0], "Test Location 01"],
  ["7d0e5a2f-04d2-4e53-bb02-9d3283b955fa", RESET_ORGANIZATIONS[0][0], "Test Location 02"],
  ["9e7b232e-a554-4b55-b5de-2944eaf494f1", RESET_ORGANIZATIONS[0][0], "Test Location 03"],
  ["6977181c-c79b-4610-8ea6-57bd57ef0802", RESET_ORGANIZATIONS[3][0], "Sun Spa"],
] as const;

export const RESET_CONFIRMATION = "RESET SOUNDSPA V2 STAGING: SIX APPROVED TEST ORGANIZATIONS";
const EXPECTED_FK_COUNT = 109;
const EXPECTED_MIGRATION_HEADS = new Set(["1793203358425", "1794060650403"]); // 0032 or 0033
const TEST_PORT = "55439";

export class StagingResetBlocked extends Error {
  constructor(readonly code: string, readonly counts: Record<string, number> = {}) {
    super(code);
    this.name = "StagingResetBlocked";
  }
}

type ResetOptions = { mode: "staging" | "test"; apply: boolean; operator: string };
type Fingerprint = { count: number; sha256: string };
type ResetReceipt = {
  result: "DRY_RUN_ROLLED_BACK" | "COMMITTED";
  deleted: Record<string, number>;
  revokedPartnerInvites: number;
  retainedDeviceOperationTombstones: number;
  preserved: Record<string, Fingerprint>;
};

const scopedQuery = (table: string, predicate: string) => `SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE ${predicate} ORDER BY t.id`;
const PRESERVED_QUERIES: Record<string, string> = {
  products: "SELECT to_jsonb(t)::text AS row FROM commercial_products t ORDER BY id",
  product_channels: "SELECT to_jsonb(t)::text AS row FROM commercial_product_channels t ORDER BY product_id,channel_id",
  channels: "SELECT to_jsonb(t)::text AS row FROM channels t ORDER BY id",
  tracks: "SELECT to_jsonb(t)::text AS row FROM channel_tracks t ORDER BY id",
  channel_translations: "SELECT to_jsonb(t)::text AS row FROM channel_translations t ORDER BY channel_id,locale",
  base_channels: "SELECT to_jsonb(t)::text AS row FROM base_channels t ORDER BY channel_id",
  payment_providers: "SELECT to_jsonb(t)::text AS row FROM commercial_payment_providers t ORDER BY code",
  payment_routes: "SELECT to_jsonb(t)::text AS row FROM commercial_payment_routes t ORDER BY id",
  payment_route_events: "SELECT to_jsonb(t)::text AS row FROM commercial_payment_route_events t ORDER BY id",
  partners: "SELECT to_jsonb(t)::text AS row FROM commercial_partners t ORDER BY id",
  offers: "SELECT to_jsonb(t)::text AS row FROM commercial_offers t ORDER BY id",
  offer_grants: "SELECT to_jsonb(t)::text AS row FROM commercial_offer_grants t ORDER BY id",
  product_visibility_events: "SELECT to_jsonb(t)::text AS row FROM commercial_product_visibility_events t ORDER BY id",
  registration_link_definitions: "SELECT id,token_hash,policy_key,policy_version,policy_snapshot,created_by_operator,creation_reason,created_at,expires_at,max_redemptions,disabled_at,disabled_by_operator,disable_reason FROM commercial_registration_links ORDER BY id",
  registration_link_events: "SELECT to_jsonb(t)::text AS row FROM commercial_registration_link_events t ORDER BY id",
  promo_definitions: "SELECT id,token_hash,partner_id,product_id,duration_days,created_by_operator,creation_reason,created_at,expires_at,max_redemptions,archived_at,archived_by_operator,revoked_at,revoked_by_operator,revoke_reason FROM commercial_spaquatoria_promo_codes ORDER BY id",
  promo_code_events: "SELECT to_jsonb(t)::text AS row FROM commercial_spaquatoria_promo_code_events t ORDER BY id",
  promo_redemption_history: "SELECT to_jsonb(t)::text AS row FROM commercial_spaquatoria_promo_redemptions t ORDER BY id",
  registration_redemption_history: "SELECT to_jsonb(t)::text AS row FROM commercial_registration_link_redemptions t ORDER BY id",
  registration_grant_history: "SELECT to_jsonb(t)::text AS row FROM commercial_registration_link_grants t ORDER BY id",
  partner_invite_definitions: "SELECT id,offer_id,token_hash,expires_at,max_claims,created_at FROM commercial_partner_invites ORDER BY id",
  migration_ledger: "SELECT to_jsonb(t)::text AS row FROM drizzle_v2.__drizzle_migrations t ORDER BY t.id",
};

const CUSTOMER_ZERO_CHECKS: Array<[string, string]> = [
  ["organizations", "SELECT count(*) FROM organizations WHERE id IN (SELECT id FROM reset_target_orgs)"],
  ["locations", "SELECT count(*) FROM locations WHERE id IN (SELECT id FROM reset_target_locations)"],
  ["organization_members", "SELECT count(*) FROM organization_members WHERE organization_id IN (SELECT id FROM reset_target_orgs)"],
  ["devices", "SELECT count(*) FROM devices WHERE id IN (SELECT id FROM reset_target_devices)"],
  ["device_activation_tokens", "SELECT count(*) FROM device_activation_tokens WHERE device_id IN (SELECT id FROM reset_target_devices)"],
  ["device_current_state", "SELECT count(*) FROM device_current_state WHERE device_id IN (SELECT id FROM reset_target_devices)"],
  ["device_events", "SELECT count(*) FROM device_events WHERE device_id IN (SELECT id FROM reset_target_devices)"],
  ["trials", "SELECT count(*) FROM location_core_trials WHERE location_id IN (SELECT id FROM reset_target_locations)"],
  ["subscriptions", "SELECT count(*) FROM location_subscriptions WHERE location_id IN (SELECT id FROM reset_target_locations)"],
  ["billing_orders", "SELECT count(*) FROM commercial_billing_orders WHERE id IN (SELECT id FROM reset_target_orders)"],
  ["billing_lines", "SELECT count(*) FROM commercial_billing_order_lines WHERE id IN (SELECT id FROM reset_target_lines)"],
  ["payments", "SELECT count(*) FROM commercial_payments WHERE id IN (SELECT id FROM reset_target_payments)"],
  ["payment_allocations", "SELECT count(*) FROM commercial_payment_allocations WHERE order_id IN (SELECT id FROM reset_target_orders) OR payment_id IN (SELECT id FROM reset_target_payments) OR order_line_id IN (SELECT id FROM reset_target_lines)"],
  ["payment_events", "SELECT count(*) FROM commercial_payment_events WHERE payment_id IN (SELECT id FROM reset_target_payments)"],
  ["payment_events", "SELECT count(*) FROM commercial_payment_events WHERE payment_id IN (SELECT id FROM reset_target_payments)"],
  ["partner_benefits", "SELECT count(*) FROM commercial_partner_benefits WHERE location_id IN (SELECT id FROM reset_target_locations)"],
  ["partner_invite_claims", "SELECT count(*) FROM commercial_partner_invite_claims WHERE location_id IN (SELECT id FROM reset_target_locations)"],
  ["billing_resets", "SELECT count(*) FROM commercial_billing_resets WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations)"],
  ["payer_references", "SELECT count(*) FROM commercial_organization_payer_references WHERE organization_id IN (SELECT id FROM reset_target_orgs)"],
  ["channel_grants", "SELECT count(*) FROM location_channel_grants WHERE location_id IN (SELECT id FROM reset_target_locations)"],
  ["channel_entitlements", "SELECT count(*) FROM location_channel_entitlements WHERE location_id IN (SELECT id FROM reset_target_locations)"],
  ["channel_visibility", "SELECT count(*) FROM location_channel_visibility WHERE location_id IN (SELECT id FROM reset_target_locations)"],
  ["service_access", "SELECT count(*) FROM location_service_access WHERE location_id IN (SELECT id FROM reset_target_locations)"],
  ["billing_permissions", "SELECT count(*) FROM location_billing_permissions WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations)"],
  ["device_playback", "SELECT (SELECT count(*) FROM hourly_device_playback WHERE device_id IN (SELECT id FROM reset_target_devices)) + (SELECT count(*) FROM hourly_channel_playback WHERE device_id IN (SELECT id FROM reset_target_devices)) + (SELECT count(*) FROM hourly_error_aggregates WHERE device_id IN (SELECT id FROM reset_target_devices))"],
  ["monitoring_lifecycle_events", "SELECT count(*) FROM monitoring_lifecycle_events WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations) OR device_id IN (SELECT id FROM reset_target_devices)"],
  ["customer_sessions", "SELECT count(*) FROM customer_sessions WHERE user_id IN (SELECT id FROM reset_target_users) OR signup_intent_id IN (SELECT id FROM reset_target_intents)"],
  ["customer_auth_tokens", "SELECT count(*) FROM customer_auth_tokens WHERE user_id IN (SELECT id FROM reset_target_users) OR signup_intent_id IN (SELECT id FROM reset_target_intents)"],
  ["signup_intents", "SELECT count(*) FROM customer_signup_intents WHERE id IN (SELECT id FROM reset_target_intents)"],
  ["users", "SELECT count(*) FROM users WHERE id IN (SELECT id FROM reset_target_users)"],
];

function canonicalFk(row: { name: string; tableFrom: string; tableTo: string; columnsFrom: string[]; columnsTo: string[]; onDelete: string; onUpdate: string }) {
  // Compare FK shape, not names: PostgreSQL truncates long identifiers and a few
  // hand-authored migrations intentionally use shorter names than Drizzle metadata.
  return [row.tableFrom, row.tableTo, row.columnsFrom.join(","), row.columnsTo.join(","), row.onDelete.toLowerCase(), row.onUpdate.toLowerCase()].join("|");
}

export async function assertDisposableTarget(client: PoolClient, mode: ResetOptions["mode"], connectionUrl: string) {
  const url = new URL(connectionUrl);
  if (mode === "test") {
    if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) || url.port !== TEST_PORT || decodeURIComponent(url.username) !== "soundspa_v2_reset_test") {
      throw new StagingResetBlocked("test_database_must_be_dedicated_loopback");
    }
  } else if (url.hostname !== "v2-postgres" || (url.port && url.port !== "5432") || decodeURIComponent(url.username) !== "soundspa_v2") {
    throw new StagingResetBlocked("database_url_must_target_v2_staging_service");
  }

  const identity = (await client.query<{ database: string; role: string; version: string; migrations: string; latest: string | null; fk_count: string }>(`
    SELECT current_database() AS database,current_user AS role,current_setting('server_version_num') AS version,
      (SELECT count(*)::text FROM drizzle_v2.__drizzle_migrations) AS migrations,
      (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest,
      (SELECT count(*)::text FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace) AS fk_count`)).rows[0];
  if (!identity || identity.database !== "soundspa_v2" || !identity.version.startsWith("16")) throw new StagingResetBlocked("database_identity_or_version_mismatch");
  if (mode === "test" ? identity.role !== "soundspa_v2_reset_test" : identity.role !== "soundspa_v2") throw new StagingResetBlocked("database_role_mismatch");
  if (!new Set(["33", "34"]).has(identity.migrations) || !identity.latest || !EXPECTED_MIGRATION_HEADS.has(identity.latest)) throw new StagingResetBlocked("migration_ledger_drift");

  const snapshotPath = new URL("../../drizzle/v2/meta/0032_snapshot.json", import.meta.url);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as { tables: Record<string, { foreignKeys: Record<string, Omit<Parameters<typeof canonicalFk>[0], "name"> & { name: string }> }> };
  const expectedFks = Object.values(snapshot.tables).flatMap((table) => Object.values(table.foreignKeys).map(canonicalFk)).sort();
  const actualFks = (await client.query<{ name: string; table_from: string; table_to: string; columns_from: string[]; columns_to: string[]; on_delete: string; on_update: string }>(`
    SELECT c.conname AS name,src.relname AS table_from,dst.relname AS table_to,
      array_agg(sa.attname::text ORDER BY sk.ord) AS columns_from,array_agg(da.attname::text ORDER BY dk.ord) AS columns_to,
      CASE c.confdeltype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS on_delete,
      CASE c.confupdtype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS on_update
    FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=src.relnamespace
    JOIN pg_class dst ON dst.oid=c.confrelid JOIN LATERAL unnest(c.conkey) WITH ORDINALITY sk(attnum,ord) ON true
    JOIN pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=sk.attnum
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY dk(attnum,ord) ON dk.ord=sk.ord
    JOIN pg_attribute da ON da.attrelid=dst.oid AND da.attnum=dk.attnum
    WHERE c.contype='f' AND sn.nspname='public' GROUP BY c.conname,src.relname,dst.relname,c.confdeltype,c.confupdtype ORDER BY c.conname`)).rows
    .map((row) => canonicalFk({ name: row.name, tableFrom: row.table_from, tableTo: row.table_to, columnsFrom: row.columns_from, columnsTo: row.columns_to, onDelete: row.on_delete, onUpdate: row.on_update })).sort();
  if (Number(identity.fk_count) !== EXPECTED_FK_COUNT || JSON.stringify(actualFks) !== JSON.stringify(expectedFks)) throw new StagingResetBlocked("foreign_key_inventory_drift");
  const expectedHead = identity.migrations === "33" ? "1793203358425" : "1794060650403";
  if (identity.latest !== expectedHead) throw new StagingResetBlocked("migration_journal_head_mismatch");
}

async function makeScope(client: PoolClient) {
  await client.query("CREATE TEMP TABLE reset_target_orgs(id uuid PRIMARY KEY,expected_name text NOT NULL) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_target_locations(id uuid PRIMARY KEY,organization_id uuid NOT NULL) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_target_users(id uuid PRIMARY KEY,email text NOT NULL) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_target_intents(id uuid PRIMARY KEY) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_target_devices(id uuid PRIMARY KEY) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_target_orders(id uuid PRIMARY KEY) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_target_lines(id uuid PRIMARY KEY) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_target_subscriptions(id uuid PRIMARY KEY) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_target_payments(id uuid PRIMARY KEY) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE reset_affected_invites(id uuid PRIMARY KEY) ON COMMIT DROP");
  await client.query("INSERT INTO reset_target_orgs(id,expected_name) SELECT * FROM unnest($1::uuid[],$2::text[])", [RESET_ORGANIZATIONS.map(([id]) => id), RESET_ORGANIZATIONS.map(([, name]) => name)]);

  // Block new Organizations while validating the exact six-Organization scope.
  await client.query("LOCK TABLE organizations IN SHARE ROW EXCLUSIVE MODE");
  const orgRows = (await client.query<{ id: string; name: string }>("SELECT id,name FROM organizations ORDER BY id FOR UPDATE")).rows;
  const expected = [...RESET_ORGANIZATIONS].map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(orgRows) !== JSON.stringify(expected)) throw new StagingResetBlocked("organization_allowlist_mismatch");
  await client.query("SELECT id FROM locations ORDER BY id FOR UPDATE");
  const locationRows = (await client.query<{ id: string; organization_id: string; name: string }>("SELECT id,organization_id,name FROM locations ORDER BY id")).rows;
  const expectedLocations = [...RESET_LOCATIONS].map(([id, organization_id, name]) => ({ id, organization_id, name })).sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(locationRows) !== JSON.stringify(expectedLocations)) throw new StagingResetBlocked("location_allowlist_mismatch");
  await client.query("INSERT INTO reset_target_locations SELECT id,organization_id FROM locations WHERE id = ANY($1::uuid[]) ORDER BY id", [RESET_LOCATIONS.map(([id]) => id)]);

  const membershipRows = await client.query<{ organization_id: string; user_id: string; role: string; membership_count: string }>(`SELECT m.organization_id,m.user_id,m.role::text AS role,count(*) OVER(PARTITION BY m.organization_id)::text AS membership_count FROM organization_members m ORDER BY m.organization_id,m.user_id`);
  if (membershipRows.rows.length !== 6 || membershipRows.rows.some((row) => row.membership_count !== "1" || row.role !== "owner" || !expected.some((org) => org.id === row.organization_id))) throw new StagingResetBlocked("membership_scope_mismatch");
  await client.query("SELECT organization_id,user_id FROM organization_members ORDER BY organization_id,user_id FOR UPDATE");
  const shared = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM (SELECT user_id FROM organization_members GROUP BY user_id HAVING count(DISTINCT organization_id)>1) s`);
  if (shared.rows[0]?.count !== "0") throw new StagingResetBlocked("shared_customer_account");
  await client.query("SELECT u.id FROM users u JOIN organization_members m ON m.user_id=u.id JOIN reset_target_orgs o ON o.id=m.organization_id ORDER BY u.id FOR UPDATE OF u");
  await client.query("INSERT INTO reset_target_users SELECT DISTINCT u.id,u.email FROM users u JOIN organization_members m ON m.user_id=u.id JOIN reset_target_orgs o ON o.id=m.organization_id ORDER BY u.id");
  const userCounts = await client.query<{ total: string; linked: string; unlinked: string }>(`SELECT (SELECT count(*)::text FROM users) AS total,(SELECT count(DISTINCT id)::text FROM reset_target_users) AS linked,(SELECT count(*)::text FROM users u WHERE NOT EXISTS(SELECT 1 FROM organization_members m WHERE m.user_id=u.id)) AS unlinked`);
  if (userCounts.rows[0]?.total !== "7" || userCounts.rows[0]?.linked !== "6" || userCounts.rows[0]?.unlinked !== "1") throw new StagingResetBlocked("customer_account_scope_mismatch");
  await client.query("INSERT INTO reset_target_intents SELECT DISTINCT si.id FROM customer_signup_intents si JOIN reset_target_users u ON lower(btrim(si.email))=u.email");
  await client.query("INSERT INTO reset_target_devices SELECT id FROM devices WHERE location_id IN (SELECT id FROM reset_target_locations) ORDER BY id FOR UPDATE");
  await client.query("INSERT INTO reset_target_orders SELECT id FROM commercial_billing_orders WHERE organization_id IN (SELECT id FROM reset_target_orgs) ORDER BY id FOR UPDATE");
  await client.query("INSERT INTO reset_target_subscriptions SELECT id FROM location_subscriptions WHERE location_id IN (SELECT id FROM reset_target_locations) ORDER BY id FOR UPDATE");
  await client.query(`INSERT INTO reset_target_lines SELECT id FROM commercial_billing_order_lines WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations) OR order_id IN (SELECT id FROM reset_target_orders) ORDER BY id FOR UPDATE`);
  await client.query(`INSERT INTO reset_target_payments SELECT p.id FROM commercial_payments p WHERE p.location_id IN (SELECT id FROM reset_target_locations) OR p.subscription_id IN (SELECT id FROM reset_target_subscriptions) OR p.billing_order_id IN (SELECT id FROM reset_target_orders) ORDER BY p.id FOR UPDATE`);
  await client.query(`INSERT INTO reset_affected_invites SELECT DISTINCT invite_id FROM commercial_partner_invite_claims WHERE location_id IN (SELECT id FROM reset_target_locations)`);

  const core = await client.query<{ devices: string; trials: string; subscriptions: string; orders: string; payments: string; fake_paid_orders: string; fake_succeeded_payments: string }>(`SELECT
    (SELECT count(*)::text FROM reset_target_devices) AS devices,
    (SELECT count(*)::text FROM location_core_trials WHERE location_id IN (SELECT id FROM reset_target_locations)) AS trials,
    (SELECT count(*)::text FROM reset_target_subscriptions) AS subscriptions,
    (SELECT count(*)::text FROM reset_target_orders) AS orders,
    (SELECT count(*)::text FROM reset_target_payments) AS payments,
    (SELECT count(*)::text FROM commercial_billing_orders WHERE id IN (SELECT id FROM reset_target_orders) AND status='paid' AND provider_code='fake-staging') AS fake_paid_orders,
    (SELECT count(*)::text FROM commercial_payments WHERE id IN (SELECT id FROM reset_target_payments) AND status='succeeded' AND provider_code='fake-staging') AS fake_succeeded_payments`);
  const row = core.rows[0];
  if (!row || row.devices !== "12" || row.trials !== "6" || row.subscriptions !== "5" || row.orders !== "6" || row.payments !== "6" || row.fake_paid_orders !== "6" || row.fake_succeeded_payments !== "6") throw new StagingResetBlocked("commercial_baseline_mismatch");

  const crossScope = await client.query<{ mismatches: string }>(`SELECT count(*)::text AS mismatches FROM commercial_payments p
    LEFT JOIN commercial_billing_orders bo ON bo.id=p.billing_order_id LEFT JOIN location_subscriptions s ON s.id=p.subscription_id
    WHERE p.id IN (SELECT id FROM reset_target_payments) AND ((p.billing_order_id IS NOT NULL AND bo.organization_id NOT IN (SELECT id FROM reset_target_orgs)) OR (p.subscription_id IS NOT NULL AND (s.location_id NOT IN (SELECT id FROM reset_target_locations) OR (p.location_id IS NOT NULL AND p.location_id<>s.location_id))))`);
  if (crossScope.rows[0]?.mismatches !== "0") throw new StagingResetBlocked("cross_scope_payment_reference");

  const protectedCounts: Record<string, string> = {};
  const protectedQueries: Record<string, string> = {
    spaquatoria_redemptions: "SELECT count(*) FROM commercial_spaquatoria_promo_redemptions WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations)",
    registration_redemptions: "SELECT count(*) FROM commercial_registration_link_redemptions WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR first_location_id IN (SELECT id FROM reset_target_locations)",
    registration_grants: "SELECT count(*) FROM commercial_registration_link_grants WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations)",
    product_authorizations: "SELECT count(*) FROM commercial_product_organization_authorizations WHERE organization_id IN (SELECT id FROM reset_target_orgs)",
    redeemed_gift_invitations: "SELECT count(*) FROM gift_access_invitations WHERE redeemed_organization_id IN (SELECT id FROM reset_target_orgs)",
    gift_grants: "SELECT count(*) FROM organization_channel_gift_grants WHERE organization_id IN (SELECT id FROM reset_target_orgs)",
  };
  for (const [name, query] of Object.entries(protectedQueries)) {
    const result = await client.query<{ count: string }>(query);
    protectedCounts[name] = result.rows[0]?.count ?? "0";
  }
  const blocked = Object.fromEntries(Object.entries(protectedCounts).filter(([, count]) => count !== "0").map(([name, count]) => [name, Number(count)]));
  if (Object.keys(blocked).length) throw new StagingResetBlocked("immutable_or_protected_history_present", blocked);
  return { protectedCounts, core: row };
}

async function fingerprint(client: PoolClient, queries = PRESERVED_QUERIES): Promise<Record<string, Fingerprint>> {
  const result: Record<string, Fingerprint> = {};
  for (const [name, query] of Object.entries(queries)) {
    let rows;
    try {
      rows = (await client.query<{ row?: string; id?: string; token_hash?: string; authenticated_user_id?: string; location_id?: string; created_at?: Date; expires_at?: Date }>(query)).rows;
    } catch {
      throw new StagingResetBlocked(`preserved_fingerprint_query_failed:${name}`);
    }
    const digest = createHash("sha256");
    for (const row of rows) digest.update(row.row ?? JSON.stringify(row)).update("\n");
    result[name] = { count: rows.length, sha256: digest.digest("hex") };
  }
  const operations = await client.query<{ operation_hash: string; authenticated_user_id: string; location_id: string; created_at: Date; expires_at: Date }>(`SELECT operation_hash,authenticated_user_id,location_id,created_at,expires_at FROM device_current_browser_operations ORDER BY operation_hash`);
  const opsHash = createHash("sha256");
  for (const row of operations.rows) opsHash.update(JSON.stringify(row)).update("\n");
  result.device_operation_tombstones = { count: operations.rows.length, sha256: opsHash.digest("hex") };
  const invites = await client.query<{ id: string; revoked_at: Date | null }>("SELECT id,revoked_at FROM commercial_partner_invites ORDER BY id");
  const inviteHash = createHash("sha256");
  for (const row of invites.rows) inviteHash.update(JSON.stringify({ id: row.id, revoked_at: row.revoked_at?.toISOString() ?? null })).update("\n");
  result.partner_invite_states = { count: invites.rows.length, sha256: inviteHash.digest("hex") };
  const lifecycleTable = await client.query<{ exists: boolean }>("SELECT to_regclass('public.organization_lifecycle_events') IS NOT NULL AS exists");
  if (lifecycleTable.rows[0]?.exists) {
    const rows = await client.query<{ row: string }>(scopedQuery("organization_lifecycle_events", "true"));
    const digest = createHash("sha256");
    for (const row of rows.rows) digest.update(row.row).update("\n");
    result.organization_lifecycle_events = { count: rows.rows.length, sha256: digest.digest("hex") };
  }
  return result;
}

async function assertFingerprintsEqual(client: PoolClient, before: Record<string, Fingerprint>) {
  const after = await fingerprint(client);
  const changed = Object.keys(before).filter((key) => key !== "partner_invite_states" && (before[key]?.count !== after[key]?.count || before[key]?.sha256 !== after[key]?.sha256));
  if (changed.length) throw new StagingResetBlocked(`preserved_fingerprint_changed:${changed.join(",")}`);
  const beforeInvites = (await client.query<{ id: string; revoked_at: Date | null }>("SELECT id,revoked_at FROM commercial_partner_invites ORDER BY id")).rows;
  const affectedInvites = new Set((await client.query<{ id: string }>("SELECT id FROM reset_affected_invites ORDER BY id")).rows.map((row) => row.id));
  const afterInvites = new Map((await client.query<{ id: string; revoked_at: Date | null }>("SELECT id,revoked_at FROM commercial_partner_invites ORDER BY id")).rows.map((row) => [row.id, row.revoked_at?.toISOString() ?? null]));
  if (beforeInvites.some((invite) => {
    const afterState = afterInvites.get(invite.id);
    const beforeState = invite.revoked_at?.toISOString() ?? null;
    return afterState === undefined || (affectedInvites.has(invite.id) ? afterState === null : afterState !== beforeState);
  })) throw new StagingResetBlocked("partner_invite_revocation_verification_failed");
  return after;
}

async function deleteScopedData(client: PoolClient) {
  const deleted: Record<string, number> = {};
  const run = async (label: string, statement: string) => {
    const result = await client.query(statement);
    deleted[label] = result.rowCount ?? 0;
  };
  const inviteRows = await client.query<{ id: string; outside: string }>(`SELECT i.id,
    (SELECT count(*)::text FROM commercial_partner_invite_claims c WHERE c.invite_id=i.id AND c.location_id NOT IN (SELECT id FROM reset_target_locations)) AS outside
    FROM commercial_partner_invites i JOIN reset_affected_invites a ON a.id=i.id FOR UPDATE OF i`);
  if (inviteRows.rows.some((row) => row.outside !== "0")) throw new StagingResetBlocked("shared_partner_invite_claims");
  await client.query("UPDATE commercial_partner_invites i SET revoked_at=COALESCE(i.revoked_at,now()) WHERE i.id IN (SELECT id FROM reset_affected_invites)");
  await run("partner_invite_claims", "DELETE FROM commercial_partner_invite_claims WHERE location_id IN (SELECT id FROM reset_target_locations)");

  await run("payment_allocations", "DELETE FROM commercial_payment_allocations WHERE order_id IN (SELECT id FROM reset_target_orders) OR payment_id IN (SELECT id FROM reset_target_payments) OR order_line_id IN (SELECT id FROM reset_target_lines)");
  await run("payment_events", "DELETE FROM commercial_payment_events WHERE payment_id IN (SELECT id FROM reset_target_payments)");
  await run("payments", "DELETE FROM commercial_payments WHERE id IN (SELECT id FROM reset_target_payments)");
  await run("billing_order_lines", "DELETE FROM commercial_billing_order_lines WHERE id IN (SELECT id FROM reset_target_lines)");
  await run("billing_orders", "DELETE FROM commercial_billing_orders WHERE id IN (SELECT id FROM reset_target_orders)");

  await run("partner_benefits", "DELETE FROM commercial_partner_benefits WHERE location_id IN (SELECT id FROM reset_target_locations)");
  await run("trials", "DELETE FROM location_core_trials WHERE location_id IN (SELECT id FROM reset_target_locations)");
  await run("subscriptions", "DELETE FROM location_subscriptions WHERE id IN (SELECT id FROM reset_target_subscriptions)");
  await run("billing_resets", "DELETE FROM commercial_billing_resets WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations)");
  await run("location_billing_permissions", "DELETE FROM location_billing_permissions WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations)");
  await run("location_channel_grants", "DELETE FROM location_channel_grants WHERE location_id IN (SELECT id FROM reset_target_locations)");
  await run("location_channel_entitlements", "DELETE FROM location_channel_entitlements WHERE location_id IN (SELECT id FROM reset_target_locations)");
  await run("location_channel_visibility", "DELETE FROM location_channel_visibility WHERE location_id IN (SELECT id FROM reset_target_locations)");
  await run("location_service_access", "DELETE FROM location_service_access WHERE location_id IN (SELECT id FROM reset_target_locations)");
  await run("payer_references", "DELETE FROM commercial_organization_payer_references WHERE organization_id IN (SELECT id FROM reset_target_orgs)");

  await run("device_activation_tokens", "DELETE FROM device_activation_tokens WHERE device_id IN (SELECT id FROM reset_target_devices)");
  await run("device_current_state", "DELETE FROM device_current_state WHERE device_id IN (SELECT id FROM reset_target_devices)");
  await run("device_events", "DELETE FROM device_events WHERE device_id IN (SELECT id FROM reset_target_devices)");
  await run("hourly_device_playback", "DELETE FROM hourly_device_playback WHERE device_id IN (SELECT id FROM reset_target_devices)");
  await run("hourly_channel_playback", "DELETE FROM hourly_channel_playback WHERE device_id IN (SELECT id FROM reset_target_devices)");
  await run("hourly_error_aggregates", "DELETE FROM hourly_error_aggregates WHERE device_id IN (SELECT id FROM reset_target_devices)");
  await run("monitoring_lifecycle_events", "DELETE FROM monitoring_lifecycle_events WHERE organization_id IN (SELECT id FROM reset_target_orgs) OR location_id IN (SELECT id FROM reset_target_locations) OR device_id IN (SELECT id FROM reset_target_devices)");
  // device_current_browser_operations are intentional replay tombstones. Deleting a Device sets only device_id NULL via FK; retain hash and user/Location context.
  await run("devices", "DELETE FROM devices WHERE id IN (SELECT id FROM reset_target_devices)");

  await run("customer_auth_tokens", "DELETE FROM customer_auth_tokens WHERE user_id IN (SELECT id FROM reset_target_users) OR signup_intent_id IN (SELECT id FROM reset_target_intents)");
  await run("customer_sessions", "DELETE FROM customer_sessions WHERE user_id IN (SELECT id FROM reset_target_users) OR signup_intent_id IN (SELECT id FROM reset_target_intents)");
  await run("signup_intents", "DELETE FROM customer_signup_intents WHERE id IN (SELECT id FROM reset_target_intents)");
  await run("organization_members", "DELETE FROM organization_members WHERE organization_id IN (SELECT id FROM reset_target_orgs)");
  await run("locations", "DELETE FROM locations WHERE id IN (SELECT id FROM reset_target_locations)");
  await run("organizations", "DELETE FROM organizations WHERE id IN (SELECT id FROM reset_target_orgs)");
  await run("customer_users", "DELETE FROM users WHERE id IN (SELECT id FROM reset_target_users)");
  return { deleted, revokedPartnerInvites: inviteRows.rows.filter((row) => row.outside === "0").length };
}

async function assertNoScopedRows(client: PoolClient) {
  const remaining: Record<string, number> = {};
  for (const [name, query] of CUSTOMER_ZERO_CHECKS) {
    const count = Number((await client.query<{ count: string }>(query)).rows[0]?.count ?? "0");
    if (count) remaining[name] = count;
  }
  const inviteRemain = Number((await client.query<{ count: string }>("SELECT count(*)::text AS count FROM commercial_partner_invite_claims WHERE location_id IN (SELECT id FROM reset_target_locations)")).rows[0]?.count ?? "0");
  if (inviteRemain) remaining.partner_invite_claims = inviteRemain;
  if (Object.keys(remaining).length) throw new StagingResetBlocked(`customer_rows_remain:${Object.keys(remaining).join(",")}`, remaining);
}

export async function runResetTransaction(client: PoolClient, options: ResetOptions, connectionUrl: string): Promise<ResetReceipt> {
  if (!options.operator.trim() || options.operator.trim().length > 200) throw new StagingResetBlocked("operator_identity_required");
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='5min'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('soundspa-v2-six-org-staging-reset'))");
    await assertDisposableTarget(client, options.mode, connectionUrl);
    await makeScope(client);
    const preservedBefore = await fingerprint(client);
    const { deleted, revokedPartnerInvites } = await deleteScopedData(client);
    await assertNoScopedRows(client);
    const preservedAfter = await assertFingerprintsEqual(client, preservedBefore);
    const operationCount = preservedAfter.device_operation_tombstones?.count ?? 0;
    if (!options.apply) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    return { result: options.apply ? "COMMITTED" : "DRY_RUN_ROLLED_BACK", deleted, revokedPartnerInvites, retainedDeviceOperationTombstones: operationCount, preserved: preservedAfter };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function inspectReadOnly(client: PoolClient, connectionUrl: string) {
  await assertDisposableTarget(client, "staging", connectionUrl);
  const organizations = await client.query<{ id: string; name: string; archived_at: Date | null; locations: string; devices: string }>(`SELECT o.id,o.name,o.archived_at,count(DISTINCT l.id)::text AS locations,count(DISTINCT d.id)::text AS devices
    FROM organizations o LEFT JOIN locations l ON l.organization_id=o.id LEFT JOIN devices d ON d.location_id=l.id GROUP BY o.id ORDER BY o.name,o.id`);
  return organizations.rows.map(({ id, name, archived_at, locations, devices }) => ({ id, name, status: archived_at ? "archived" : "active", locations: Number(locations), devices: Number(devices) }));
}

function parseArgs(argv: string[]) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--inspect")) return { mode: "inspect" as const };
  if (argv.length === 1 && argv[0] === "--dry-run") return { mode: "dry-run" as const };
  if (argv.length === 3 && argv[0] === "--apply" && argv[1] === "--confirm" && argv[2] === RESET_CONFIRMATION) return { mode: "apply" as const };
  throw new StagingResetBlocked("invalid_arguments");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connectionUrl = process.env.V2_DATABASE_URL ?? "";
  if (!connectionUrl) throw new StagingResetBlocked("V2_DATABASE_URL_required");
  if (args.mode === "dry-run" && process.env.V2_STAGING_RESET_TEST !== "1") throw new StagingResetBlocked("dry_run_must_use_isolated_test_mode");
  if (args.mode === "apply" && process.env.V2_STAGING_RESET_OPERATOR?.trim() === undefined) throw new StagingResetBlocked("V2_STAGING_RESET_OPERATOR_required");
  const pool = new Pool({ connectionString: connectionUrl, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    if (args.mode === "inspect") {
      const organizations = await inspectReadOnly(client, connectionUrl);
      console.info(JSON.stringify({ result: "READ_ONLY_INVENTORY", organizations }));
      return;
    }
    const receipt = await runResetTransaction(client, { mode: args.mode === "dry-run" ? "test" : "staging", apply: args.mode === "apply", operator: process.env.V2_STAGING_RESET_OPERATOR ?? "" }, connectionUrl);
    console.info(JSON.stringify(receipt));
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("reset-v2-staging-customer-data.ts")) {
  main().catch((error: unknown) => {
    const blocked = error as { name?: unknown; code?: unknown; counts?: unknown };
    const safeCode = typeof blocked?.code === "string" ? blocked.code : error instanceof Error ? error.message : "reset_failed";
    const counts = blocked?.counts && typeof blocked.counts === "object" ? blocked.counts : undefined;
    console.error(JSON.stringify({ result: "STOPPED", code: safeCode, ...(counts ? { blockers: counts } : {}) }));
    process.exitCode = 1;
  });
}
