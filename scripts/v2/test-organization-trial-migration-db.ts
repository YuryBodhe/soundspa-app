import assert from "node:assert/strict";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.V2_DATABASE_URL;
const testPort = process.env.V2_ORG_TRIAL_MIGRATION_TEST_PORT;
if (process.env.V2_ORG_TRIAL_MIGRATION_TEST_ALLOW_DATABASE !== "1" || !databaseUrl || !testPort) {
  throw new Error("Refusing Organization Trial migration test: explicit disposable-loopback opt-in, port, and V2_DATABASE_URL are required.");
}
const target = new URL(databaseUrl);
const role = decodeURIComponent(target.username);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname) ||
    decodeURIComponent(target.pathname) !== "/soundspa_v2" || target.port !== testPort ||
    new Set(["soundspa_v2", "postgres", "root"]).has(role)) {
  throw new Error("Refusing Organization Trial migration test: only the explicitly configured isolated loopback PostgreSQL 16 database is allowed.");
}
process.env.V2_DATABASE_URL = databaseUrl;

async function main() {
  const [{ Pool }, { drizzle }, schema, { migrate }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("../../db/v2/schema"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const testDb = drizzle(pool, { schema });
  const client = await pool.connect();
  try {
    const identity = (await client.query<{
      database: string; role: string; address: string | null; version: string; port: number;
      migrationCount: number; latest: string; organizations: string; trials: string;
      tableMissing: boolean; productId: string | null;
    }>(`SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS address,
      current_setting('server_version_num') AS version,inet_server_port() AS port,
      (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS "migrationCount",
      (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest,
      (SELECT count(*)::text FROM organizations) AS organizations,
      (SELECT count(*)::text FROM location_core_trials) AS trials,
      to_regclass('public.organization_core_trials') IS NULL AS "tableMissing",
      (SELECT id::text FROM commercial_products WHERE code='soundspa' LIMIT 1) AS "productId"`)).rows[0];
    const address = identity?.address?.split("/")[0] ?? "";
    if (!identity || identity.database !== "soundspa_v2" || identity.role !== role ||
        !identity.version.startsWith("16") || isIP(address) === 0 || !new Set(["127.0.0.1", "::1"]).has(address) ||
        String(identity.port) !== testPort || identity.migrationCount !== 34 || identity.latest !== "1794060650403" ||
        identity.organizations !== "0" || identity.trials !== "0" || !identity.tableMissing) {
      throw new Error("Refusing Organization Trial migration test: expected empty isolated PostgreSQL 16 at V2 migration 0033.");
    }

    const suffix = randomUUID();
    const basicProductId = identity.productId ?? (await client.query<{ id: string }>(`INSERT INTO commercial_products
      (code,name,kind,is_active,visibility,catalog_visibility)
      VALUES ('soundspa','SoundSpa Basic','core',true,'public','public') RETURNING id`)).rows[0]!.id;
    const createOrganization = async (name: string, createdAt: Date) => (await client.query<{ id: string }>(
      "INSERT INTO organizations (name,created_at,updated_at) VALUES ($1,$2,$2) RETURNING id", [name, createdAt],
    )).rows[0]!.id;
    const createLocation = async (organizationId: string, name: string, createdAt: Date) => (await client.query<{ id: string }>(
      `INSERT INTO locations (organization_id,name,slug,timezone,created_at,updated_at)
       VALUES ($1,$2,$3,'Asia/Ho_Chi_Minh',$4,$4) RETURNING id`,
      [organizationId, name, `trial-${suffix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, createdAt],
    )).rows[0]!.id;

    const exactStart = new Date("2026-11-08T05:40:47.733Z");
    const exactEnd = new Date("2026-12-06T05:40:47.733Z");
    const firstCreated = new Date("2026-11-08T05:40:47.721Z");
    const e2eOrg = await createOrganization(`trial-e2e-${suffix}`, firstCreated);
    const e2eLocation1 = await createLocation(e2eOrg, "e2e-one", firstCreated);
    const e2eLocation2 = await createLocation(e2eOrg, "e2e-two", new Date("2026-11-08T06:45:57.740Z"));
    const legacyTrialId = (await client.query<{ id: string }>(`INSERT INTO location_core_trials
      (location_id,product_id,status,starts_at,ends_at,created_at,updated_at)
      VALUES ($1,$2,'active',$3,$4,$5,$5) RETURNING id`,
      [e2eLocation1, basicProductId, exactStart, exactEnd, firstCreated])).rows[0]!.id;

    const now = (await client.query<{ now: Date }>("SELECT CURRENT_TIMESTAMP AS now")).rows[0]!.now;
    const expiredOrg = await createOrganization(`trial-expired-${suffix}`, new Date("2026-01-01T00:00:00Z"));
    const expiredLocation1 = await createLocation(expiredOrg, "expired-one", new Date("2026-01-01T00:00:00Z"));
    await createLocation(expiredOrg, "expired-two", new Date("2026-02-01T00:00:00Z"));
    await client.query(`INSERT INTO location_core_trials (location_id,product_id,status,starts_at,ends_at)
      VALUES ($1,$2,'expired','2026-01-01T00:00:00Z','2026-01-29T00:00:00Z')`, [expiredLocation1, basicProductId]);

    const capOrg = await createOrganization(`trial-cap-${suffix}`, new Date(now.getTime() - 60_000));
    const capLocations: string[] = [];
    for (let i = 0; i < 6; i++) capLocations.push(await createLocation(capOrg, `cap-${i}`, new Date(now.getTime() - 50_000 + i * 1_000)));
    await client.query(`INSERT INTO location_core_trials (location_id,product_id,status,starts_at,ends_at)
      VALUES ($1,$2,'active',$3,$4)`, [capLocations[0], basicProductId, new Date(now.getTime() - 30_000), new Date(now.getTime() + 30 * 86_400_000)]);

    const sharedWindowOrg = await createOrganization(`trial-shared-window-${suffix}`, new Date(now.getTime() - 86_400_000));
    const sharedWindowLocation1 = await createLocation(sharedWindowOrg, "shared-one", new Date(now.getTime() - 86_400_000));
    const sharedWindowLocation2 = await createLocation(sharedWindowOrg, "shared-two", new Date(now.getTime() - 80_000_000));
    const sharedStart = new Date(now.getTime() - 86_400_000);
    const sharedEnd = new Date(now.getTime() + 27 * 86_400_000);
    await client.query(`INSERT INTO location_core_trials (location_id,product_id,status,starts_at,ends_at)
      VALUES ($1,$3,'active',$4,$5),($2,$3,'active',$4,$5)`, [sharedWindowLocation1, sharedWindowLocation2, basicProductId, sharedStart, sharedEnd]);

    await migrate(testDb, { migrationsFolder: "drizzle/v2", migrationsSchema: "drizzle_v2", migrationsTable: "__drizzle_migrations" });

    const canonical = (await client.query<{ startsAt: string; endsAt: string; status: string; origin: string }>(`SELECT
      to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "startsAt",
      to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "endsAt",status,origin
      FROM organization_core_trials WHERE organization_id=$1`, [e2eOrg])).rows[0];
    assert.deepEqual(canonical, {
      startsAt: "2026-11-08 05:40:47.733", endsAt: "2026-12-06 05:40:47.733", status: "active", origin: "legacy_backfill",
    }, "E2E Organization window must be copied exactly to milliseconds");

    const allocationRows = (await client.query<{ locationId: string; slotNumber: number; source: string; legacyTrialId: string | null; legacyOrigin: string | null; allocatedAt: string }>(`SELECT
      location_id AS "locationId",slot_number AS "slotNumber",source,legacy_trial_id AS "legacyTrialId",legacy_origin AS "legacyOrigin",
      to_char(allocated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "allocatedAt"
      FROM organization_core_trial_locations WHERE organization_id=$1 ORDER BY slot_number`, [e2eOrg])).rows;
    assert.equal(allocationRows.length, now >= exactStart && now < exactEnd ? 2 : 1);
    assert.equal(allocationRows[0]?.locationId, e2eLocation1);
    assert.equal(allocationRows[0]?.slotNumber, 1);
    assert.equal(allocationRows[0]?.source, "legacy_trial");
    assert.equal(allocationRows[0]?.legacyTrialId, legacyTrialId);
    assert.equal(allocationRows[0]?.legacyOrigin, "onboarding_inferred");
    assert.equal(allocationRows[1]?.locationId, e2eLocation2);
    if (allocationRows[1]) {
      assert.equal(allocationRows[1].slotNumber, 2);
      assert.equal(allocationRows[1].source, "active_window_backfill");
      assert.equal(allocationRows[1].legacyTrialId, null);
      assert.equal(allocationRows[1].allocatedAt, "2026-11-08 06:45:57.740");
    }

    const oldTrial = (await client.query<{ startsAt: string; endsAt: string; status: string }>(`SELECT
      to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "startsAt",
      to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS') AS "endsAt",status
      FROM location_core_trials WHERE id=$1`, [legacyTrialId])).rows[0];
    assert.deepEqual(oldTrial, { startsAt: "2026-11-08 05:40:47.733", endsAt: "2026-12-06 05:40:47.733", status: "active" }, "Legacy trial row must remain unchanged");

    const expiredCount = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM organization_core_trial_locations WHERE organization_id=$1", [expiredOrg])).rows[0]?.count;
    assert.equal(expiredCount, 1, "expired trial must not retroactively allocate an additional Location");

    const sharedWindowTrialCount = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM organization_core_trials WHERE organization_id=$1", [sharedWindowOrg])).rows[0]?.count;
    const sharedWindowAllocationCount = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM organization_core_trial_locations WHERE organization_id=$1", [sharedWindowOrg])).rows[0]?.count;
    assert.equal(sharedWindowTrialCount, 1, "same-window legacy Location trials become one Organization trial");
    assert.equal(sharedWindowAllocationCount, 2, "both same-window legacy Locations retain trial-enabled slots");

    const capCount = (await client.query<{ count: number; maxSlot: number }>(`SELECT count(*)::int AS count,max(slot_number)::int AS "maxSlot"
      FROM organization_core_trial_locations WHERE organization_id=$1`, [capOrg])).rows[0];
    assert.equal(capCount?.count, 5, "active backfill must cap total Locations at five");
    assert.equal(capCount?.maxSlot, 5);

    const journal = (await client.query<{ count: number; latest: string }>(`SELECT count(*)::int AS count,
      max(created_at)::text AS latest FROM drizzle_v2.__drizzle_migrations`)).rows[0];
    assert.equal(journal?.count, 35);
    assert.equal(journal?.latest, "1794131239809");

    const migrationSql = await readFile("drizzle/v2/0034_organization_scoped_basic_trials.sql", "utf8");
    assert.match(migrationSql, /LOCK TABLE location_core_trials, locations IN SHARE ROW EXCLUSIVE MODE/,
      "migration must serialize the legacy backfill against onboarding writes");
    const guard = migrationSql.match(/DO \$\$[\s\S]*?END \$\$;/)?.[0];
    assert(guard, "migration must include a conflict and five-slot preflight guard");
    await client.query("BEGIN");
    await client.query("SAVEPOINT conflicting_window");
    const conflictOrg = await createOrganization(`trial-conflict-${suffix}`, new Date(now.getTime() - 10_000));
    const conflictLoc1 = await createLocation(conflictOrg, "conflict-one", new Date(now.getTime() - 10_000));
    const conflictLoc2 = await createLocation(conflictOrg, "conflict-two", new Date(now.getTime() - 9_000));
    await client.query(`INSERT INTO location_core_trials (location_id,product_id,status,starts_at,ends_at)
      VALUES ($1,$3,'active',$4,$5),($2,$3,'active',$6,$7)`, [conflictLoc1, conflictLoc2, basicProductId,
      new Date(now.getTime() - 10_000), new Date(now.getTime() + 28 * 86_400_000),
      new Date(now.getTime() - 9_000), new Date(now.getTime() + 28 * 86_400_000)]);
    await assert.rejects(client.query(guard), (error: { code?: string; constraint?: string }) =>
      error.code === "23514" && error.constraint === "organization_core_trials_legacy_window_conflict");
    await client.query("ROLLBACK TO SAVEPOINT conflicting_window");
    await client.query("RELEASE SAVEPOINT conflicting_window");

    await client.query("SAVEPOINT over_five_slots");
    const overCapOrg = await createOrganization(`trial-over-cap-${suffix}`, new Date(now.getTime() - 20_000));
    for (let i = 0; i < 6; i++) {
      const locationId = await createLocation(overCapOrg, `over-cap-${i}`, new Date(now.getTime() - 20_000 + i * 1_000));
      await client.query(`INSERT INTO location_core_trials (location_id,product_id,status,starts_at,ends_at)
        VALUES ($1,$2,'active',$3,$4)`, [locationId, basicProductId, new Date(now.getTime() - 30_000), new Date(now.getTime() + 28 * 86_400_000)]);
    }
    await assert.rejects(client.query(guard), (error: { code?: string; constraint?: string }) =>
      error.code === "23514" && error.constraint === "organization_core_trials_legacy_location_cap");
    await client.query("ROLLBACK TO SAVEPOINT over_five_slots");
    await client.query("RELEASE SAVEPOINT over_five_slots");

    await client.query("SAVEPOINT repeated_location_trial");
    const repeatedOrg = await createOrganization(`trial-repeated-${suffix}`, new Date(now.getTime() - 20_000));
    const repeatedLocation = await createLocation(repeatedOrg, "repeated", new Date(now.getTime() - 20_000));
    const repeatedStart = new Date(now.getTime() - 30_000);
    const repeatedEnd = new Date(now.getTime() + 28 * 86_400_000);
    const reset = (await client.query<{ id: string }>(`INSERT INTO commercial_billing_resets
      (organization_id,location_id,product_ids,operator,reason,trial_duration_days,affected_records)
      VALUES ($1,$2,$3::uuid[],'migration-test-operator','Migration test reset history',28,
        '{"subscriptions":[],"trials":[],"ordersCanceled":[],"paymentsCanceled":[],"legacyLocationAccess":null}'::jsonb)
      RETURNING id`, [repeatedOrg, repeatedLocation, [basicProductId]])).rows[0]!.id;
    await client.query(`INSERT INTO location_core_trials (location_id,product_id,status,starts_at,ends_at)
      VALUES ($1,$2,'active',$3,$4)`, [repeatedLocation, basicProductId, repeatedStart, repeatedEnd]);
    await client.query(`INSERT INTO location_core_trials (location_id,product_id,status,starts_at,ends_at,invalidated_by_reset_id)
      VALUES ($1,$2,'active',$3,$4,$5)`, [repeatedLocation, basicProductId, repeatedStart, repeatedEnd, reset]);
    await assert.rejects(client.query(guard), (error: { code?: string; constraint?: string }) =>
      error.code === "23514" && error.constraint === "organization_core_trials_legacy_location_repeat");
    await client.query("ROLLBACK TO SAVEPOINT repeated_location_trial");
    await client.query("RELEASE SAVEPOINT repeated_location_trial");
    await client.query("COMMIT");
    const conflictCount = (await client.query<{ count: string }>("SELECT count(*)::text AS count FROM organizations WHERE name=$1", [`trial-conflict-${suffix}`])).rows[0]?.count;
    assert.equal(conflictCount, "0", "failed conflict preflight transaction must leave no rows");

    await assert.rejects(client.query("UPDATE organization_core_trials SET ends_at=ends_at + interval '1 day' WHERE organization_id=$1", [e2eOrg]));
    await assert.rejects(client.query("DELETE FROM organization_core_trial_locations WHERE organization_id=$1", [e2eOrg]));
    await assert.rejects(client.query("TRUNCATE organization_core_trial_locations"));
    await assert.rejects(client.query("INSERT INTO organization_core_trials (organization_id,product_id,status,starts_at,ends_at,origin) SELECT organization_id,product_id,status,starts_at,ends_at,'legacy_backfill' FROM organization_core_trials WHERE organization_id=$1", [e2eOrg]));

    await migrate(testDb, { migrationsFolder: "drizzle/v2", migrationsSchema: "drizzle_v2", migrationsTable: "__drizzle_migrations" });
    const journalAfterRepeat = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations")).rows[0]?.count;
    assert.equal(journalAfterRepeat, 35, "re-running the migrator must not create a second trial or reapply the migration");

    console.info(JSON.stringify({
      postgres: 16, migration: "0034", migrationCount: journal?.count,
      e2eExactWindow: canonical, e2eLocations: allocationRows.length,
      expiredAdditionalLocationSkipped: true, cumulativeLocationCap: capCount?.count,
      sameWindowLegacyLocationsCombined: sharedWindowAllocationCount,
      conflictingWindowRejectedAndRolledBack: true, overFiveLegacyLocationsRejected: true,
      repeatedLocationTrialRejected: true, immutableWindowAndLedger: true, result: "PASS",
    }));
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
