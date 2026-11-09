import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const connectionString = process.env.V2_GIFT_DRAFT_TEST_DATABASE_URL;
assert(connectionString, "Set V2_GIFT_DRAFT_TEST_DATABASE_URL to an isolated local PostgreSQL 16 database.");
const parsed = new URL(connectionString);
assert(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname), "Gift draft integration tests only accept loopback PostgreSQL.");
assert.equal(parsed.pathname, "/soundspa_v2", "Use the dedicated draft test database name.");
assert.equal(parsed.username, "soundspa_gift_draft_test", "Use the dedicated non-superuser test role.");
process.env.V2_DATABASE_URL = connectionString;
const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 3_000 });
const uuid = () => randomUUID();

async function expectForeignKeyFailure(sql: string, values: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SAVEPOINT expected_fk_failure");
    try {
      await client.query(sql, values);
      assert.fail("Expected a tenant-scope foreign key to reject the row");
    } catch (error) {
      assert.equal((error as { code?: string }).code, "23503");
    }
    await client.query("ROLLBACK TO SAVEPOINT expected_fk_failure");
    await client.query("RELEASE SAVEPOINT expected_fk_failure");
    await client.query("ROLLBACK");
  } finally { client.release(); }
}

async function main() {
  const identity = await pool.query<{ version: string; current_database: string; current_user: string; server_addr: string; is_superuser: boolean }>(`
    SELECT current_setting('server_version') AS version, current_database(), current_user,
      inet_server_addr()::text AS server_addr,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
  assert.match(identity.rows[0]?.version ?? "", /^16\./, "Integration database must be PostgreSQL 16");
  assert.equal(identity.rows[0]?.current_database, "soundspa_v2");
  assert.equal(identity.rows[0]?.current_user, "soundspa_gift_draft_test");
  assert(["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"].includes(identity.rows[0]?.server_addr ?? ""), "Database must listen on loopback only");
  assert.equal(identity.rows[0]?.is_superuser, false, "Tests must use a non-superuser role");

  const [{ createOrResumeSpaquatoriaGiftDraft, listSpaquatoriaGiftDraftsForUser, updateSpaquatoriaGiftDraft }, baseline] = await Promise.all([
    import("../../db/v2/services/spaquatoriaGiftDrafts"),
    pool.query<{ ledger: string; drafts: string }>(`SELECT (SELECT count(*)::text FROM drizzle_v2.__drizzle_migrations) AS ledger,
      (SELECT count(*)::text FROM commercial_spaquatoria_gift_drafts) AS drafts`),
  ]);
  assert.equal(baseline.rows[0]?.ledger, "39", "Apply migrations through 0038 before running these tests");
  const emptyFixtureDb = await pool.query<{ organizations: string; locations: string; drafts: string }>(`SELECT
    (SELECT count(*)::text FROM organizations) AS organizations,
    (SELECT count(*)::text FROM locations) AS locations,
    (SELECT count(*)::text FROM commercial_spaquatoria_gift_drafts) AS drafts`);
  assert.equal(emptyFixtureDb.rows[0]?.organizations, "0", "Use an empty, disposable database; never run against customer data");
  assert.equal(emptyFixtureDb.rows[0]?.locations, "0", "Use an empty, disposable database; never run against customer data");
  assert.equal(emptyFixtureDb.rows[0]?.drafts, "0", "Use an empty, disposable database; never run against customer data");

  const orgA = uuid(); const orgB = uuid(); const orgArchived = uuid();
  const ownerA = uuid(); const adminA = uuid(); const managerA = uuid(); const unverifiedA = uuid(); const ownerB = uuid(); const ownerArchived = uuid();
  const locA1 = uuid(); const locA2 = uuid(); const locA3 = uuid(); const locB = uuid(); const locArchivedOrg = uuid();
  const trialId = uuid(); const slotId = uuid(); const deviceId = uuid(); const assignmentId = uuid();
  const orgIds = [orgA, orgB, orgArchived];
  const userIds = [ownerA, adminA, managerA, unverifiedA, ownerB, ownerArchived];
  const now = new Date();
  const emailValues = userIds.map((_, i) => `gift-draft-${i}-${uuid()}@example.invalid`);
  let productId: string | null = null;
  let basicWindow: { startsAt: Date; endsAt: Date } | null = null;

  try {
    const fixture = await pool.connect();
    try {
      await fixture.query("BEGIN");
      await fixture.query("INSERT INTO organizations (id,name) VALUES ($1,'Gift Draft Org A'),($2,'Gift Draft Org B'),($3,'Gift Draft Archived Org')", orgIds);
      await fixture.query(`INSERT INTO users (id,email,email_verified_at) VALUES
      ($1,$4,$7),($2,$5,$7),($3,$6,$7),($8,$9,$7),($10,$11,$7),($12,$13,$7)`,
      [ownerA, adminA, managerA, emailValues[0], emailValues[1], emailValues[2], now, unverifiedA, emailValues[3], ownerB, emailValues[4], ownerArchived, emailValues[5]]);
      await fixture.query(`UPDATE users SET email_verified_at=NULL WHERE id=$1`, [unverifiedA]);
      await fixture.query(`INSERT INTO organization_members (organization_id,user_id,role) VALUES
      ($1,$4,'owner'),($1,$5,'admin'),($1,$6,'manager'),($1,$7,'owner'),($2,$8,'owner'),($3,$9,'owner')`,
      [orgA, orgB, orgArchived, ownerA, adminA, managerA, unverifiedA, ownerB, ownerArchived]);
      await fixture.query(`INSERT INTO locations (id,organization_id,name,slug,timezone) VALUES
      ($1,$5,'Gift Draft A1','gift-draft-a1','Europe/Moscow'),($2,$5,'Gift Draft A2','gift-draft-a2','Europe/Moscow'),
      ($3,$5,'Gift Draft A3','gift-draft-a3','Europe/Moscow'),($4,$6,'Gift Draft B1','gift-draft-b1','Europe/Moscow'),
      ($7,$8,'Gift Draft Archived','gift-draft-archived','Europe/Moscow')`,
      [locA1, locA2, locA3, locB, orgA, orgB, locArchivedOrg, orgArchived]);
      const existingBasic = await fixture.query<{ id: string }>("SELECT id FROM commercial_products WHERE code='soundspa' LIMIT 1");
      if (existingBasic.rows[0]) productId = existingBasic.rows[0].id;
      else {
        productId = uuid();
        await fixture.query(`INSERT INTO commercial_products (id,code,name,kind,price_minor,currency,billing_interval_months)
          VALUES ($1,'soundspa','SoundSpa Basic Test Fixture','core',108000,'RUB',1)`, [productId]);
      }
      basicWindow = { startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 27 * 86_400_000) };
      await fixture.query(`INSERT INTO organization_core_trials (id,organization_id,product_id,status,starts_at,ends_at,origin,created_at,updated_at)
        VALUES ($1,$2,$3,'active',$4,$5,'first_location_creation',$6,$6)`, [trialId, orgA, productId, basicWindow.startsAt, basicWindow.endsAt, now]);
      await fixture.query(`INSERT INTO organization_core_trial_locations (id,organization_trial_id,organization_id,location_id,slot_number,source,allocated_at,created_at)
        VALUES ($1,$2,$3,$4,1,'first_location_creation',$5,$5)`, [slotId, trialId, orgA, locA1, now]);
      await fixture.query(`INSERT INTO devices (id,location_id,credential_hash,status,label,created_at,updated_at)
        VALUES ($1,$2,$3,'active','Existing Basic device fixture',$4,$4)`, [deviceId, locA1, `fixture-${deviceId}`, now]);
      await fixture.query(`INSERT INTO device_product_assignments (id,device_id,product_id,source,assigned_at)
        VALUES ($1,$2,$3,'legacy_basic_backfill',$4)`, [assignmentId, deviceId, productId, now]);
      await fixture.query("COMMIT");
    } catch (error) {
      await fixture.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      fixture.release();
    }
    const baselineCommercial = await pool.query(`SELECT
      (SELECT count(*) FROM organization_core_trials) AS org_trials,
      (SELECT count(*) FROM organization_core_trial_locations) AS trial_slots,
      (SELECT count(*) FROM location_core_trials) AS legacy_trials,
      (SELECT count(*) FROM location_subscriptions) AS subscriptions,
      (SELECT count(*) FROM commercial_partner_benefits) AS partner_benefits,
      (SELECT count(*) FROM commercial_promotional_access.location_product_promotional_access) AS promotional_access,
      (SELECT count(*) FROM device_product_assignments) AS device_assignments,
      (SELECT count(*) FROM commercial_agreement_acceptances) AS acceptances,
      (SELECT count(*) FROM commercial_spaquatoria_gift_eligibility) AS gift_eligibility`);
    await expectForeignKeyFailure(`INSERT INTO commercial_spaquatoria_gift_drafts (organization_id,location_id,created_by_user_id,updated_by_user_id)
      VALUES ($1,$2,$3,$3)`, [orgA, locB, ownerA]);

    const first = await createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: ownerA, organizationId: orgA, locationId: locA1, now });
    assert.equal(first.resumed, false);
    assert.equal(first.draft.status, "draft");
    assert.equal(first.draft.version, 1);
    assert.deepEqual(first.missingFields, ["legalForm", "legalName", "taxId", "registrationNumber", "physicalAddress", "representativeName", "representativeRole", "authorityStatement"]);
    const resumedByAdmin = await createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: adminA, organizationId: orgA, locationId: locA1, now });
    assert.equal(resumedByAdmin.resumed, true);
    assert.equal(resumedByAdmin.draft.id, first.draft.id);
    assert.equal(resumedByAdmin.draft.createdByUserId, ownerA, "Resumption preserves original creator");

    const partial = await updateSpaquatoriaGiftDraft({
      authenticatedUserId: ownerA, draftId: first.draft.id, expectedVersion: 1, now,
      patch: { legalForm: "ru_legal_entity", legalName: "ООО Черновик", taxId: "770", registrationNumber: "102", physicalAddress: "г. Москва, ул. Тестовая, д. 1", representativeName: "Иван", authorityStatement: "Подтверждаю полномочия для заполнения черновика." },
    });
    assert.equal(partial.draft.version, 2);
    assert.equal(partial.draft.taxId, "770", "Incomplete tax identifiers can be saved");
    assert.equal(partial.draft.authorityStatement, "Подтверждаю полномочия для заполнения черновика.");
    assert(!("acceptanceId" in partial.draft), "Draft response contains no acceptance reference");

    await assert.rejects(
      updateSpaquatoriaGiftDraft({ authenticatedUserId: adminA, draftId: first.draft.id, expectedVersion: 1, patch: { legalName: "Stale" } }),
      (error: { code?: string }) => error.code === "version_conflict",
    );

    const simultaneous = await Promise.allSettled([
      updateSpaquatoriaGiftDraft({ authenticatedUserId: adminA, draftId: first.draft.id, expectedVersion: 2, patch: { representativeRole: "Director" } }),
      updateSpaquatoriaGiftDraft({ authenticatedUserId: ownerA, draftId: first.draft.id, expectedVersion: 2, patch: { representativePhone: "+7 900 000-00-00" } }),
    ]);
    assert.equal(simultaneous.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(simultaneous.filter((result) => result.status === "rejected").length, 1, "One concurrent editor receives a version conflict");
    const conflict = simultaneous.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.equal((conflict.reason as { code?: string }).code, "version_conflict");

    const creations = await Promise.all([
      createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: ownerA, organizationId: orgA, locationId: locA2 }),
      createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: adminA, organizationId: orgA, locationId: locA2 }),
    ]);
    assert.equal(creations.filter((result) => !result.resumed).length, 1);
    assert.equal(creations.filter((result) => result.resumed).length, 1);
    assert.equal(creations[0].draft.id, creations[1].draft.id, "Concurrent creation is serialized to the single Location draft");
    const locA2Draft = creations[0].draft;
    const duplicateAddress = await updateSpaquatoriaGiftDraft({
      authenticatedUserId: ownerA, draftId: locA2Draft.id, expectedVersion: 1,
      patch: { physicalAddress: "г Москва ул Тестовая д 1", taxId: "770" },
    });
    assert.equal(duplicateAddress.draft.normalizedPhysicalAddress, partial.draft.normalizedPhysicalAddress,
      "Independent drafts may carry a duplicate address; drafts do not reserve physical premises");
    assert.equal(duplicateAddress.draft.taxId, partial.draft.taxId, "Draft INN values do not reserve a global legal entity identity");

    const otherTenantDraft = await createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: ownerB, organizationId: orgB, locationId: locB });
    await assert.rejects(
      updateSpaquatoriaGiftDraft({ authenticatedUserId: ownerB, draftId: first.draft.id, expectedVersion: 2, patch: { legalName: "Cross tenant" } }),
      (error: { code?: string }) => error.code === "draft_unavailable",
    );
    assert.equal((await listSpaquatoriaGiftDraftsForUser(ownerA)).length, 2);
    assert.equal((await listSpaquatoriaGiftDraftsForUser(ownerB)).length, 1);
    assert.equal((await listSpaquatoriaGiftDraftsForUser(managerA)).length, 0, "Billing-only manager has no legal-draft read permission");
    await assert.rejects(
      createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: managerA, organizationId: orgA, locationId: locA3 }),
      (error: { code?: string }) => error.code === "location_unavailable",
    );
    await assert.rejects(
      createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: unverifiedA, organizationId: orgA, locationId: locA3 }),
      (error: { code?: string }) => error.code === "location_unavailable",
    );

    const archivedLocationDraft = await createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: ownerA, organizationId: orgA, locationId: locA3 });
    await pool.query("UPDATE locations SET archived_at=$2 WHERE id=$1", [locA3, now]);
    await assert.rejects(
      updateSpaquatoriaGiftDraft({ authenticatedUserId: ownerA, draftId: archivedLocationDraft.draft.id, expectedVersion: 1, patch: { legalName: "No change" } }),
      (error: { code?: string }) => error.code === "draft_unavailable",
    );
    await assert.rejects(
      createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: ownerA, organizationId: orgA, locationId: locA3 }),
      (error: { code?: string }) => error.code === "location_unavailable",
    );
    const archivedOrgDraft = await createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: ownerArchived, organizationId: orgArchived, locationId: locArchivedOrg });
    await pool.query("UPDATE organizations SET archived_at=$2 WHERE id=$1", [orgArchived, now]);
    await assert.rejects(
      updateSpaquatoriaGiftDraft({ authenticatedUserId: ownerArchived, draftId: archivedOrgDraft.draft.id, expectedVersion: 1, patch: { legalName: "No change" } }),
      (error: { code?: string }) => error.code === "draft_unavailable",
    );
    await assert.rejects(
      createOrResumeSpaquatoriaGiftDraft({ authenticatedUserId: ownerArchived, organizationId: orgArchived, locationId: locArchivedOrg }),
      (error: { code?: string }) => error.code === "location_unavailable",
    );

    const afterCommercial = await pool.query(`SELECT
      (SELECT count(*) FROM organization_core_trials) AS org_trials,
      (SELECT count(*) FROM organization_core_trial_locations) AS trial_slots,
      (SELECT count(*) FROM location_core_trials) AS legacy_trials,
      (SELECT count(*) FROM location_subscriptions) AS subscriptions,
      (SELECT count(*) FROM commercial_partner_benefits) AS partner_benefits,
      (SELECT count(*) FROM commercial_promotional_access.location_product_promotional_access) AS promotional_access,
      (SELECT count(*) FROM device_product_assignments) AS device_assignments,
      (SELECT count(*) FROM commercial_agreement_acceptances) AS acceptances,
      (SELECT count(*) FROM commercial_spaquatoria_gift_eligibility) AS gift_eligibility`);
    assert.deepEqual(afterCommercial.rows, baselineCommercial.rows, "Draft operations do not modify Basic, payments, benefits, promotions, acceptances or Gift eligibility");
    const preservedBasic = await pool.query<{ starts_at: Date; ends_at: Date; device_id: string; product_id: string }>(`SELECT t.starts_at,t.ends_at,a.device_id,a.product_id
      FROM organization_core_trials t JOIN organization_core_trial_locations s ON s.organization_trial_id=t.id
      JOIN device_product_assignments a ON a.device_id=$2 AND a.product_id=t.product_id
      WHERE t.id=$1 AND s.id=$3`, [trialId, deviceId, slotId]);
    assert.equal(preservedBasic.rows.length, 1);
    assert.equal(preservedBasic.rows[0]?.starts_at.getTime(), basicWindow!.startsAt.getTime());
    assert.equal(preservedBasic.rows[0]?.ends_at.getTime(), basicWindow!.endsAt.getTime());
    assert.equal(preservedBasic.rows[0]?.device_id, deviceId);
    assert.equal(preservedBasic.rows[0]?.product_id, productId);

    const draftRows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM commercial_spaquatoria_gift_drafts WHERE organization_id=ANY($1::uuid[])", [orgIds]);
    assert.equal(draftRows.rows[0]?.count, "5", "One shared draft per created Location; archived Location/Organization drafts remain non-commercial history");
    console.info("V2 Spaquatoria Gift Draft PostgreSQL 16 integration PASS: partial fields save and resume; Owners/Admins share one same-Location draft; stale/concurrent updates conflict; Location uniqueness is enforced; INN/address duplicates remain unreserved across drafts; cross-tenant, manager, unverified and archived access is rejected; Basic trial dates/device assignment and all legal/commercial entitlements remain unchanged. Destroy this disposable database after the run (trial slot history is intentionally append-only).");
    void otherTenantDraft;
  } finally {
    // The fixture includes an immutable Organization Trial slot. Never bypass
    // its protection for cleanup; destroy the explicitly disposable database.
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Gift draft PostgreSQL integration failed.");
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
  const { v2Pool } = await import("../../db/v2/client");
  await v2Pool.end();
});
