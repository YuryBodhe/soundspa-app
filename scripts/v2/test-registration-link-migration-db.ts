import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.V2_DATABASE_URL;
if (process.env.V2_REGISTRATION_LINK_MIGRATION_TEST_ALLOW_DATABASE !== "1" || !databaseUrl) {
  throw new Error("Refusing migration test: set explicit opt-in and V2_DATABASE_URL for a disposable local database at migration 0021.");
}
const target = new URL(databaseUrl);
const role = decodeURIComponent(target.username);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname) || decodeURIComponent(target.pathname) !== "/soundspa_v2" || new Set(["soundspa_v2", "postgres", "root"]).has(role)) {
  throw new Error("Refusing migration test: only a dedicated loopback soundspa_v2 database role is allowed.");
}
process.env.V2_DATABASE_URL = databaseUrl;
async function main() {
const [{ v2Db, v2Pool }, { migrate }] = await Promise.all([
  import("../../db/v2/client"), import("drizzle-orm/node-postgres/migrator"),
]);
const database = (await v2Pool.query<{
  database: string; role: string; address: string | null; version: string; migrationCount: number; latest: string;
}>(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address,
  current_setting('server_version_num') AS version, (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS "migrationCount",
  (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest`)).rows[0];
const address = database?.address?.split("/")[0] ?? "";
if (!database || database.database !== "soundspa_v2" || database.role !== role || !database.version.startsWith("16") ||
    isIP(address) === 0 || !new Set(["127.0.0.1", "::1"]).has(address) || database.migrationCount !== 22 || database.latest !== "1792004696226") {
  throw new Error("Refusing migration test: database must be an isolated PostgreSQL 16 test instance at migration 0021.");
}
const existing = await v2Pool.query<{ total: string }>(`SELECT
  (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) +
  (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_product_organization_authorizations) AS total`);
if (existing.rows[0]?.total !== "0") throw new Error("Refusing migration test: isolated database must have no Organizations, Products, or authorization history.");

try {
  const suffix = randomUUID();
  const now = new Date("2026-10-15T10:00:00.000Z");
  const organization = (await v2Pool.query<{ id: string }>("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`legacy-grant-${suffix}`])).rows[0]!;
  const product = (await v2Pool.query<{ id: string }>("INSERT INTO commercial_products (code,name,kind) VALUES ($1,$2,'core') RETURNING id", [`legacy-grant-${suffix}`, "Legacy Grant Test Product"])).rows[0]!;
  const activeId = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_product_organization_authorizations
    (organization_id,product_id,granted_by_operator,grant_reason,granted_at)
    VALUES ($1,$2,$3,$4,$5) RETURNING id`, [organization.id, product.id, "legacy-real-operator", "Existing manual operator authorization", now])).rows[0]!.id;
  const revokedId = (await v2Pool.query<{ id: string }>(`INSERT INTO commercial_product_organization_authorizations
    (organization_id,product_id,granted_by_operator,grant_reason,granted_at,revoked_at,revoked_by_operator,revoke_reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [organization.id, product.id, "legacy-second-operator", "Historical manual authorization", now, new Date(now.getTime() + 60_000), "legacy-revoker", "Historical revocation retained"])).rows[0]!.id;

  await migrate(v2Db, { migrationsFolder: "drizzle/v2", migrationsSchema: "drizzle_v2", migrationsTable: "__drizzle_migrations" });
  const rows = (await v2Pool.query<{
    id: string; granted_by_operator: string | null; grant_source: string; registration_redemption_id: string | null;
    revoked_at: Date | null; revoked_by_operator: string | null; revoke_reason: string | null;
  }>(`SELECT id,granted_by_operator,grant_source,registration_redemption_id,revoked_at,revoked_by_operator,revoke_reason
    FROM commercial_product_organization_authorizations WHERE id = ANY($1::uuid[])`, [[activeId, revokedId]])).rows;
  const active = rows.find((row) => row.id === activeId);
  const revoked = rows.find((row) => row.id === revokedId);
  assert(active); assert(revoked);
  assert.equal(active.granted_by_operator, "legacy-real-operator");
  assert.equal(active.grant_source, "operator");
  assert.equal(active.registration_redemption_id, null);
  assert.equal(active.revoked_at, null);
  assert.equal(revoked.granted_by_operator, "legacy-second-operator");
  assert.equal(revoked.grant_source, "operator");
  assert.equal(revoked.registration_redemption_id, null);
  assert.equal(revoked.revoked_by_operator, "legacy-revoker");
  assert.equal(revoked.revoke_reason, "Historical revocation retained");
  const after = await v2Pool.query<{ migrationCount: number; latest: string }>(`SELECT (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS "migrationCount", (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest`);
  assert.equal(after.rows[0]?.migrationCount, 23);
  assert.equal(after.rows[0]?.latest, "1792025178280");
  console.info("V2 Registration Link migration PASS: applied 0022 once and preserved active/revoked legacy operator identities, source, and revocation history.");
} finally {
  await v2Pool.end();
}
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
