import { isIP } from "node:net";
import { Pool } from "pg";

const connectionString = process.env.V2_DATABASE_URL;
if (process.env.V2_PROMOTIONAL_ACCESS_PREFLIGHT_ALLOW_READ_ONLY !== "1" ||
    process.env.V2_PROMOTIONAL_ACCESS_PREFLIGHT_TARGET !== "soundspa_v2" || !connectionString) {
  throw new Error("Refusing Promotional Access preflight: explicit read-only opt-in, target database, and V2_DATABASE_URL are required.");
}
const target = new URL(connectionString);
const database = decodeURIComponent(target.pathname).replace(/^\//, "");
if (database !== "soundspa_v2" || !["postgres:", "postgresql:"].includes(target.protocol)) {
  throw new Error("Refusing Promotional Access preflight: only PostgreSQL database soundspa_v2 is supported.");
}

async function main() {
  const pool = new Pool({ connectionString, max: 1, application_name: "soundspa-v2-promotional-access-read-only-preflight" });
  const client = await pool.connect();
  try {
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const identity = (await client.query<{ database: string; version: string; migrations: string; latest: string }>(`SELECT
      current_database() AS database, current_setting('server_version_num') AS version,
      (SELECT count(*)::text FROM drizzle_v2.__drizzle_migrations) AS migrations,
      (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest`)).rows[0];
    const address = target.hostname;
    if (!identity || identity.database !== "soundspa_v2" || !identity.version.startsWith("16") ||
        (!new Set(["localhost", "v2-postgres"]).has(address) && !new Set(["127.0.0.1", "::1"]).has(address))) {
      throw new Error("Refusing Promotional Access preflight: expected the explicitly selected PostgreSQL 16 V2 staging/isolated database.");
    }
    if (identity.migrations !== "35" || identity.latest !== "1794131239809") {
      throw new Error("Refusing Promotional Access preflight: expected the source schema through migration 0034.");
    }

    const trials = await client.query<{ product: string; status: string; classification: string; count: string }>(`SELECT p.code AS product,t.status::text AS status,
      CASE WHEN t.invalidated_by_reset_id IS NOT NULL THEN 'invalidated'
           WHEN t.registration_link_grant_id IS NOT NULL THEN 'registration_link_source'
           WHEN led.legacy_trial_id IS NOT NULL AND led.legacy_origin='onboarding_inferred' THEN 'canonical_onboarding_inferred'
           WHEN led.legacy_trial_id IS NOT NULL AND led.legacy_origin='unknown' THEN 'canonical_origin_unknown_review'
           WHEN led.legacy_trial_id IS NOT NULL AND led.legacy_origin='registration_link' THEN 'canonical_registration_link_review'
           WHEN led.legacy_trial_id IS NOT NULL AND led.legacy_origin='partner_invite_possible' THEN 'canonical_partner_invite_possible_review'
           WHEN led.legacy_trial_id IS NOT NULL THEN 'canonical_other_origin_review'
           ELSE 'unlinked_legacy_review' END AS classification,
      count(*)::text AS count
      FROM location_core_trials t JOIN commercial_products p ON p.id=t.product_id
      LEFT JOIN organization_core_trial_locations led ON led.legacy_trial_id=t.id
      GROUP BY p.code,t.status,classification ORDER BY p.code,t.status,classification`);

    const registration = await client.query<{ product: string; accessType: string; total: string; linked: string; exactDates: string }>(`SELECT p.code AS product,g.access_type AS "accessType",count(*)::text AS total,
      count(t.id)::text AS linked,count(*) FILTER (WHERE t.starts_at=g.starts_at AND t.ends_at=g.ends_at)::text AS "exactDates"
      FROM commercial_registration_link_grants g JOIN commercial_products p ON p.id=g.product_id
      LEFT JOIN location_core_trials t ON t.registration_link_grant_id=g.id
      GROUP BY p.code,g.access_type ORDER BY p.code,g.access_type`);

    const partner = await client.query<{ product: string; grantType: string; durationDays: number | null; offers: string; invites: string; claims: string; canonicalOriginFlags: string }>(`SELECT p.code AS product,g.grant_type AS "grantType",g.duration_days AS "durationDays",
      count(DISTINCT g.offer_id)::text AS offers,count(DISTINCT i.id)::text AS invites,count(DISTINCT c.id)::text AS claims,
      count(DISTINCT led.location_id) FILTER (WHERE led.legacy_origin='partner_invite_possible')::text AS "canonicalOriginFlags"
      FROM commercial_offer_grants g JOIN commercial_products p ON p.id=g.product_id
      LEFT JOIN commercial_partner_invites i ON i.offer_id=g.offer_id
      LEFT JOIN commercial_partner_invite_claims c ON c.invite_id=i.id
      LEFT JOIN locations l ON l.id=c.location_id
      LEFT JOIN organization_core_trial_locations led ON led.location_id=l.id
      GROUP BY p.code,g.grant_type,g.duration_days ORDER BY p.code,g.grant_type,g.duration_days`);

    const candidates = await client.query<{ classification: string; count: string }>(`WITH basic_trials AS (
        SELECT t.id,t.location_id,t.starts_at,t.ends_at,t.registration_link_grant_id,
          (SELECT count(*) FROM commercial_partner_invite_claims c
           JOIN commercial_partner_invites i ON i.id=c.invite_id
           JOIN commercial_offer_grants g ON g.offer_id=i.offer_id AND g.grant_type='trial'
           JOIN commercial_products p ON p.id=g.product_id AND p.code='soundspa'
           WHERE c.location_id=t.location_id AND t.registration_link_grant_id IS NULL
             AND c.claimed_at=t.starts_at AND t.ends_at=c.claimed_at+(g.duration_days * interval '1 day')) AS exact_partner_matches
        FROM location_core_trials t JOIN commercial_products p ON p.id=t.product_id AND p.code='soundspa'
        WHERE t.invalidated_by_reset_id IS NULL
      )
      SELECT CASE WHEN registration_link_grant_id IS NOT NULL THEN 'registration_link_provenance'
                  WHEN exact_partner_matches=1 THEN 'partner_invite_exact_candidate'
                  WHEN exact_partner_matches=0 THEN 'no_exact_partner_candidate_review'
                  ELSE 'multiple_partner_candidates_review' END AS classification,count(*)::text AS count
      FROM basic_trials GROUP BY classification ORDER BY classification`);

    const overlap = await client.query<{ kind: string; count: string }>(`WITH tr AS (
        SELECT t.location_id,t.product_id,t.starts_at,t.ends_at FROM location_core_trials t
        JOIN commercial_products p ON p.id=t.product_id WHERE p.code='soundspa' AND t.invalidated_by_reset_id IS NULL),
      paid AS (
        SELECT s.location_id,s.product_id,s.starts_at,coalesce(s.current_period_ends_at,'infinity'::timestamptz) ends_at
        FROM location_subscriptions s JOIN commercial_products p ON p.id=s.product_id
        WHERE p.code='soundspa' AND s.invalidated_by_reset_id IS NULL AND s.status IN ('active','canceled')),
      benefits AS (
        SELECT b.location_id,b.product_id,b.starts_at,coalesce(b.ends_at,'infinity'::timestamptz) ends_at
        FROM commercial_partner_benefits b JOIN commercial_products p ON p.id=b.product_id WHERE p.code='soundspa')
      SELECT 'trial_paid' AS kind,count(*)::text AS count FROM tr JOIN paid USING(location_id,product_id) WHERE tr.starts_at<paid.ends_at AND tr.ends_at>paid.starts_at
      UNION ALL SELECT 'trial_partner_benefit',count(*)::text FROM tr JOIN benefits USING(location_id,product_id) WHERE tr.starts_at<benefits.ends_at AND tr.ends_at>benefits.starts_at
      UNION ALL SELECT 'paid_partner_benefit',count(*)::text FROM paid JOIN benefits USING(location_id,product_id) WHERE paid.starts_at<benefits.ends_at AND paid.ends_at>benefits.starts_at`);

    const canonical = await client.query<{ origin: string; count: string; slots: string }>(`SELECT t.origin,count(DISTINCT t.id)::text AS count,count(led.id)::text AS slots
      FROM organization_core_trials t JOIN commercial_products p ON p.id=t.product_id AND p.code='soundspa'
      LEFT JOIN organization_core_trial_locations led ON led.organization_trial_id=t.id
      GROUP BY t.origin ORDER BY t.origin`);

    console.log(JSON.stringify({
      mode: "read-only; no backfill or updates performed",
      database: identity.database,
      postgresMajor: identity.version.slice(0, 2),
      migrationEntries: identity.migrations,
      trialRows: trials.rows,
      canonicalOrganizationTrials: canonical.rows,
      registrationLinkGrants: registration.rows,
      partnerInviteGrantConfigurationAndClaims: partner.rows,
      partnerTrialAttributionCandidates: candidates.rows,
      periodOverlaps: overlap.rows,
      note: "Legacy-origin flags are classification hints only; ambiguous rows require manual review. No customer names, emails, tokens, or secrets are queried or printed.",
      targetHostClass: isIP(address) ? "loopback" : "V2 compose service name",
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Read-only preflight failed.";
  console.error(message);
  process.exitCode = 1;
});
