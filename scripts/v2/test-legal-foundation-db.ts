import assert from "node:assert/strict";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";

const connectionString = process.env.V2_LEGAL_FOUNDATION_TEST_DATABASE_URL;
assert(connectionString, "Set V2_LEGAL_FOUNDATION_TEST_DATABASE_URL to an isolated local PostgreSQL 16 database.");
const parsed = new URL(connectionString);
assert(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname), "Legal foundation tests only accept loopback PostgreSQL.");
assert.equal(parsed.pathname, "/soundspa_v2", "Use the dedicated legal test database name inside the isolated cluster.");
assert.equal(parsed.username, "soundspa_legal_test", "Use the dedicated non-production test role.");

const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 3_000 });
const uuid = () => randomUUID();
const sha256 = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

async function expectFailure(client: import("pg").PoolClient, sql: string, values: unknown[], expectedCodes: string[]) {
  await client.query("SAVEPOINT legal_expected_failure");
  try {
    await client.query(sql, values);
    assert.fail("Expected SQL operation to be rejected");
  } catch (error) {
    const code = (error as { code?: string }).code;
    assert(expectedCodes.includes(code ?? ""), `Expected SQLSTATE in ${expectedCodes.join(",")}, received ${code ?? "unknown"} for ${sql.slice(0, 96)}`);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT legal_expected_failure");
    await client.query("RELEASE SAVEPOINT legal_expected_failure");
  }
}

async function main() {
  const identity = await pool.query<{ version: string; current_database: string; current_user: string; server_addr: string; is_superuser: boolean }>(`
    SELECT current_setting('server_version') AS version, current_database(), current_user,
      inet_server_addr()::text AS server_addr,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
  assert.match(identity.rows[0]?.version ?? "", /^16\./, "Integration database must be PostgreSQL 16");
  assert.equal(identity.rows[0]?.current_database, "soundspa_v2");
  assert.equal(identity.rows[0]?.current_user, "soundspa_legal_test");
  assert(["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"].includes(identity.rows[0]?.server_addr ?? ""), "Database server must listen only through loopback");
  assert.equal(identity.rows[0]?.is_superuser, false, "Tests must use a non-superuser database role");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const org1 = uuid(); const org2 = uuid();
    const loc1 = uuid(); const loc2 = uuid(); const locOther = uuid(); const locOther2 = uuid();
    const user1 = uuid(); const user2 = uuid();
    const legal1 = uuid(); const legal2 = uuid();
    const profile1 = uuid(); const profile2 = uuid(); const otherProfile = uuid();
    const doc = uuid(); const version = uuid(); const draftVersion = uuid();
    const acceptance1 = uuid(); const acceptance2 = uuid(); const eligibility1 = uuid();
    const now = new Date();

    const triggerNames = await client.query<{ tgname: string }>(`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'commercial_legal_document_versions_guard','commercial_legal_document_events_append_only',
        'commercial_legal_documents_identity_immutable','commercial_legal_entities_guard','commercial_location_legal_profiles_guard',
        'commercial_agreement_acceptances_guard','commercial_agreement_acceptance_events_append_only',
        'commercial_spaquatoria_gift_eligibility_guard','commercial_spaquatoria_gift_eligibility_events_append_only',
        'commercial_spaquatoria_gift_device_events_guard','commercial_spaquatoria_gift_device_events_no_truncate')`);
    assert.equal(triggerNames.rowCount, 11, "All document, legal-profile, acceptance, eligibility and Gift-device protections must be installed");

    await client.query("INSERT INTO organizations (id,name) VALUES ($1,'Legal Foundation Test A'),($2,'Legal Foundation Test B')", [org1, org2]);
    await client.query(`INSERT INTO users (id,email,email_verified_at) VALUES ($1,'legal-foundation-a@example.invalid',$3),($2,'legal-foundation-b@example.invalid',$3)`, [user1, user2, now]);
    await client.query(`INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$3,'owner'),($2,$4,'owner')`, [org1, org2, user1, user2]);
    await client.query(`INSERT INTO locations (id,organization_id,name,slug,timezone) VALUES
      ($1,$3,'Legal Test Location 1','legal-test-location-1','Europe/Moscow'),
      ($2,$3,'Legal Test Location 2','legal-test-location-2','Europe/Moscow'),
      ($4,$5,'Legal Test Other Tenant','legal-test-location-other','Europe/Moscow'),
      ($6,$5,'Legal Test Other Tenant 2','legal-test-location-other-2','Europe/Moscow')`, [loc1, loc2, org1, locOther, org2, locOther2]);
    await client.query(`INSERT INTO commercial_legal_entities (id,organization_id,legal_form,legal_name,tax_id,registration_number)
      VALUES ($1,$2,'ru_legal_entity','ООО Тест','7701234567','1027700132195'),($3,$4,'ru_individual_entrepreneur','ИП Тест','123456789012','123456789012345')`, [legal1, org1, legal2, org2]);
    await client.query(`INSERT INTO commercial_location_legal_profiles (id,organization_id,legal_entity_id,location_id,physical_address,normalized_address)
      VALUES ($1,$2,$3,$4,'г. Москва, ул. Тестовая, д. 1','г москва ул тестовая д 1'),
      ($5,$2,$3,$6,'г. Москва, ул. Тестовая, д. 1','г москва ул тестовая д 1'),
      ($7,$8,$9,$10,'г. Казань, ул. Тестовая, д. 1','г казань ул тестовая д 1')`,
      [profile1, org1, legal1, loc1, profile2, loc2, otherProfile, org2, legal2, locOther]);
    const multiLocation = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM commercial_location_legal_profiles WHERE legal_entity_id=$1", [legal1]);
    assert.equal(multiLocation.rows[0]?.count, "2", "One legal entity must support multiple physical Locations");

    const crossTenantProfile = uuid();
    await expectFailure(client, `INSERT INTO commercial_location_legal_profiles (id,organization_id,legal_entity_id,location_id,physical_address,normalized_address)
      VALUES ($1,$2,$3,$4,'wrong tenant address','wrong tenant address')`, [crossTenantProfile, org2, legal1, locOther2], ["23503"]);

    await client.query("INSERT INTO commercial_legal_documents (id,code,jurisdiction,locale) VALUES ($1,'spaquatoria-public-performance-license','RU','ru')", [doc]);
    const content = "Draft agreement text used only by rollback test.";
    const contentHash = sha256(content);
    await client.query(`INSERT INTO commercial_legal_document_versions (id,document_id,version,title,content,content_sha256,status,created_by)
      VALUES ($1,$2,1,'Test draft',$3,$4,'draft','legal-test-operator')`, [version, doc, content, contentHash]);
    await client.query(`INSERT INTO commercial_legal_document_versions (id,document_id,version,title,content,content_sha256,status,created_by)
      VALUES ($1,$2,2,'Unpublished draft',$3,$4,'draft','legal-test-operator')`, [draftVersion, doc, content, contentHash]);
    await expectFailure(client, `INSERT INTO commercial_legal_document_versions (document_id,version,title,content,content_sha256,status,created_by)
      VALUES ($1,3,'Bad hash draft',$2,$3,'draft','legal-test-operator')`, [doc, content, "0".repeat(64)], ["23514"]);
    await client.query(`UPDATE commercial_legal_document_versions SET status='published',published_by='legal-test-operator',published_at=$2,publication_reason='Rollback-only schema integration test'
      WHERE id=$1`, [version, now]);
    await expectFailure(client, "UPDATE commercial_legal_document_versions SET content='mutated' WHERE id=$1", [version], ["P0001"]);
    await expectFailure(client, "DELETE FROM commercial_legal_document_versions WHERE id=$1", [version], ["P0001"]);
    await expectFailure(client, `UPDATE commercial_legal_document_versions SET status='published',published_by='legal-test-operator',published_at=$2,publication_reason=NULL
      WHERE id=$1`, [draftVersion, now], ["P0001"]);
    const docEvents = await client.query<{ action: string }>("SELECT action FROM commercial_legal_document_events WHERE document_version_id=$1", [version]);
    assert.deepEqual(docEvents.rows.map((row) => row.action).sort(), ["draft_created", "published"].sort());

    const legalSnapshot = JSON.stringify({ legalForm: "ru_legal_entity", legalName: "ООО Тест", taxId: "7701234567", registrationNumber: "1027700132195" });
    const locationSnapshot = JSON.stringify({ physicalAddress: "г. Москва, ул. Тестовая, д. 1" });
    await client.query(`INSERT INTO commercial_agreement_acceptances (id,organization_id,legal_entity_id,location_id,legal_profile_id,
      document_version_id,document_sha256,legal_entity_snapshot,location_snapshot,signer_user_id,signer_name,signer_role,authority_declaration,acceptance_method,idempotency_key,accepted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,'Test signer','authorized representative','I declare signing authority for test only','test_fixture',$11,$12)`,
      [acceptance1, org1, legal1, loc1, profile1, version, contentHash, legalSnapshot, locationSnapshot, user1, uuid(), now]);
    await expectFailure(client, `INSERT INTO commercial_agreement_acceptances (id,organization_id,legal_entity_id,location_id,legal_profile_id,
      document_version_id,document_sha256,legal_entity_snapshot,location_snapshot,signer_user_id,signer_name,signer_role,authority_declaration,acceptance_method,idempotency_key,accepted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,'Test signer','authorized representative','I declare signing authority for test only','test_fixture',$11,$12)`,
      [uuid(), org1, legal1, loc1, profile1, version, contentHash, JSON.stringify({ legalForm: "ru_legal_entity", legalName: "Different", taxId: "7701234567", registrationNumber: "1027700132195" }), locationSnapshot, user1, uuid(), now], ["P0001"]);
    await expectFailure(client, "UPDATE commercial_legal_entities SET legal_name='Changed after acceptance' WHERE id=$1", [legal1], ["P0001"]);
    await expectFailure(client, "UPDATE commercial_location_legal_profiles SET physical_address='Changed after acceptance' WHERE id=$1", [profile1], ["P0001"]);
    await expectFailure(client, `INSERT INTO commercial_agreement_acceptances (id,organization_id,legal_entity_id,location_id,legal_profile_id,
      document_version_id,document_sha256,legal_entity_snapshot,location_snapshot,signer_user_id,signer_name,signer_role,authority_declaration,acceptance_method,idempotency_key,accepted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,'Test signer','authorized representative','I declare signing authority for test only','test_fixture',$11,$12)`,
      [uuid(), org1, legal1, loc1, profile1, draftVersion, contentHash, legalSnapshot, locationSnapshot, user1, uuid(), now], ["P0001"]);
    await expectFailure(client, `INSERT INTO commercial_agreement_acceptances (id,organization_id,legal_entity_id,location_id,legal_profile_id,
      document_version_id,document_sha256,legal_entity_snapshot,location_snapshot,signer_user_id,signer_name,signer_role,authority_declaration,acceptance_method,idempotency_key,accepted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,'Test signer','authorized representative','I declare signing authority for test only','test_fixture',$11,$12)`,
      [uuid(), org1, legal1, loc1, profile1, version, "0".repeat(64), legalSnapshot, locationSnapshot, user1, uuid(), now], ["P0001"]);
    await expectFailure(client, "UPDATE commercial_agreement_acceptances SET signer_name='Changed signer' WHERE id=$1", [acceptance1], ["P0001"]);
    await expectFailure(client, "DELETE FROM commercial_agreement_acceptances WHERE id=$1", [acceptance1], ["P0001"]);

    await client.query(`INSERT INTO commercial_agreement_acceptances (id,organization_id,legal_entity_id,location_id,legal_profile_id,
      document_version_id,document_sha256,legal_entity_snapshot,location_snapshot,signer_user_id,signer_name,signer_role,authority_declaration,acceptance_method,idempotency_key,accepted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,'Test signer','authorized representative','I declare signing authority for test only','test_fixture',$11,$12)`,
      [acceptance2, org1, legal1, loc2, profile2, version, contentHash, legalSnapshot, locationSnapshot, user1, uuid(), now]);
    await client.query(`INSERT INTO commercial_spaquatoria_gift_eligibility (id,organization_id,legal_entity_id,location_id,legal_profile_id,acceptance_id,physical_location_key)
      VALUES ($1,$2,$3,$4,$5,$6,'г москва ул тестовая д 1')`, [eligibility1, org1, legal1, loc1, profile1, acceptance1]);
    await expectFailure(client, `INSERT INTO commercial_spaquatoria_gift_eligibility (organization_id,legal_entity_id,location_id,legal_profile_id,acceptance_id,physical_location_key)
      VALUES ($1,$2,$3,$4,$5,'г москва ул тестовая д 1')`, [org1, legal1, loc2, profile2, acceptance2], ["23505"]);
    const submittedEvents = await client.query<{ action: string; actor_type: string }>("SELECT action,actor_type FROM commercial_spaquatoria_gift_eligibility_events WHERE eligibility_id=$1", [eligibility1]);
    assert.equal(submittedEvents.rows[0]?.action, "submitted");
    assert.equal(submittedEvents.rows[0]?.actor_type, "customer");
    await client.query(`UPDATE commercial_spaquatoria_gift_eligibility SET status='eligible',reviewed_by_operator='legal-test-operator',reviewed_at=$2,review_reason='Rollback-only approval fixture' WHERE id=$1`, [eligibility1, new Date(now.getTime() + 1000)]);
    await client.query(`UPDATE commercial_spaquatoria_gift_eligibility SET status='revoked',reviewed_by_operator='legal-test-operator',reviewed_at=$2,review_reason='Rollback-only revocation fixture' WHERE id=$1`, [eligibility1, new Date(now.getTime() + 2000)]);
    await expectFailure(client, "UPDATE commercial_spaquatoria_gift_eligibility SET status='eligible' WHERE id=$1", [eligibility1], ["P0001"]);
    await expectFailure(client, "DELETE FROM commercial_spaquatoria_gift_eligibility_events WHERE eligibility_id=$1", [eligibility1], ["P0001"]);
    const eligibilityEvents = await client.query<{ action: string; from_status: string | null; to_status: string }>("SELECT action,from_status,to_status FROM commercial_spaquatoria_gift_eligibility_events WHERE eligibility_id=$1 ORDER BY occurred_at", [eligibility1]);
    assert.deepEqual(eligibilityEvents.rows.map(({ action, from_status, to_status }) => [action, from_status, to_status]), [
      ["submitted", null, "pending_review"], ["approved", "pending_review", "eligible"], ["revoked", "eligible", "revoked"],
    ]);
    const acceptanceRevocationId = uuid();
    await client.query(`INSERT INTO commercial_agreement_acceptance_events (id,acceptance_id,action,actor,reason,occurred_at)
      VALUES ($1,$2,'revoked','legal-test-operator','Rollback-only acceptance revocation',$3)`, [acceptanceRevocationId, acceptance2, new Date(now.getTime() + 3000)]);
    await expectFailure(client, `INSERT INTO commercial_spaquatoria_gift_eligibility (organization_id,legal_entity_id,location_id,legal_profile_id,acceptance_id,physical_location_key)
      VALUES ($1,$2,$3,$4,$5,'г москва ул тестовая д 1')`, [org1, legal1, loc2, profile2, acceptance2], ["P0001"]);
    await expectFailure(client, "DELETE FROM commercial_agreement_acceptance_events WHERE id=$1", [acceptanceRevocationId], ["P0001"]);

    const accessCounts = await client.query<{ benefits: string; assignments: string; legacy_gifts: string }>(`
      SELECT (SELECT count(*)::text FROM commercial_partner_benefits b JOIN locations l ON l.id=b.location_id WHERE l.organization_id IN ($1,$2)) AS benefits,
        (SELECT count(*)::text FROM device_product_assignments a JOIN devices d ON d.id=a.device_id JOIN locations l ON l.id=d.location_id WHERE l.organization_id IN ($1,$2)) AS assignments,
        (SELECT count(*)::text FROM organization_channel_gift_grants WHERE organization_id IN ($1,$2)) AS legacy_gifts`, [org1, org2]);
    assert.equal(accessCounts.rows[0]?.benefits, "0");
    assert.equal(accessCounts.rows[0]?.assignments, "0");
    assert.equal(accessCounts.rows[0]?.legacy_gifts, "0");
    await client.query("ROLLBACK");
    console.info("V2 Legal Foundation PostgreSQL 16 integration PASS: multiple Locations share one Russian legal entity; tenant-scoped FKs reject cross-tenant profiles; published document versions and acceptance/audit history are immutable; unpublished or hash-mismatched acceptance is rejected; physical-location duplicate is blocked; eligibility requires accepted evidence and produces audited one-way review/revocation events; legal foundation alone creates no Partner Benefits, legacy gifts, Device assignments, or access records. All fixtures rolled back.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Legal foundation integration failed.");
  process.exitCode = 1;
}).finally(async () => pool.end());
