# SoundSpa V2 production deployment (prepared configuration)

This is a future runbook, not authorization to provision or deploy. The production Compose project is `soundspa-v2-production`; staging remains `soundspa-v2`. Never use the V1 Compose file for either V2 environment.

## Configuration and isolation

- Compose file: `docker-compose.production.yml`; project, app, PostgreSQL container, network, PostgreSQL volume, and host media directory all use production-only names.
- PostgreSQL is private to the production Docker network and has no published port. Its database name is `soundspa_v2`, as required by `db/v2/connectionConfig.ts`; it is a separate PostgreSQL service and volume from staging, not a shared cluster/database.
- Runtime connects as `soundspa_v2_app`; the migration runner uses `soundspa_v2_migrator`; the PostgreSQL bootstrap owner is separate. The first-initialization script creates roles and default table/sequence grants. The script runs only when PostgreSQL initializes an empty volume. It must not be treated as an upgrade script.
- The app is bound only to `127.0.0.1:3102`, distinct from staging’s 3101. Host Nginx terminates TLS and proxies to this loopback port.
- Production reads the existing published Timeweb S3/CDN catalog using a production-specific **read-only** S3 credential. Staging keeps its existing write credential; production never receives write/delete permission. The production CDN base is the existing published media host. The production database must reference only canonical published track keys and `covers/` image keys; local `artwork/` keys must be imported/published before launch.
- The storage code does not namespace keys by deployment environment. Thus staging test uploads can physically coexist in the shared bucket and may be publicly fetchable if their URLs are known. They do not enter the production catalog unless production data references them. If strict physical isolation of test objects is required, the media key model must add environment prefixes or staging must use a separate write bucket; neither is configured here.
- Production media admin uploads are intentionally expected to fail under the read-only credential. Content changes must use a separately reviewed publication process until production-safe write permissions and object namespaces are designed.
- Copy `.env.v2.production.example` to `/etc/soundspa-v2/production.env`; replace all placeholders and set owner `root:root`, mode `0600`. Do not put a real env file in the repository. Current Compose environment variables are visible to host root and Docker administrators; evaluate Docker secrets/external secret management before expanding the operator set.
- `V2_DATABASE_URL` must use the app role; `V2_MIGRATION_DATABASE_URL` must use the migrator role. URL-encode passwords and keep them equal to the corresponding role passwords. Do not use a V1 URL. The legacy `DATABASE_URL` is an unreachable build/runtime placeholder and must never be pointed at V1.
- `V2_PUBLIC_ORIGIN` is the production HTTPS origin. `V2_DEPLOYMENT_ENV=production` and `V2_FAKE_PROVIDER_ENABLED=0` keep the staging fake payment provider unavailable. Billing integration is not supplied by this configuration.

## External prerequisites (not configured here)

1. A production image registry and CI release pipeline capable of building once, testing, publishing by commit SHA, and returning an immutable digest; a reviewed immutable PostgreSQL 16 image digest is also required.
2. DNS A/AAAA records for `soundspa2.bodhemusic.com`; validate addresses before change. The media CDN hostname in the env file also needs a separately approved DNS/TLS/storage setup.
3. A verified production TLS certificate at the paths in `deploy/nginx/soundspa2.bodhemusic.com.conf`, ACME webroot availability, and review of the active Nginx include tree. The template is not active Nginx configuration.
4. Unique PostgreSQL owner, app, and migrator passwords; production operator credentials; email API key and verified sender; endpoint, bucket, region and **read-only** access keys for the existing published Timeweb media catalog; registry read credentials. No values are supplied here.
5. Host directories with approved owner/mode for `/var/backups/soundspa-v2-production` and `/var/lib/soundspa-v2-production-media`; sufficient RAM/disk headroom; firewall rules; log rotation; monitoring and alert destinations.
6. A reviewed catalog/media bootstrap procedure. Customers are re-registering, but the first production database still needs approved Products, channels, channel assets, and compositions. Reuse canonical published media keys and channel IDs where required for existing covers. Do not run seed/provision scripts until each is reviewed for idempotency and production scope.
7. An approved decision on direct public media URLs versus signed/authenticated media delivery. This app’s current media URLs are public static URLs; production Compose does not make those URLs entitlement-protected.
8. Billing decision for the initial cohort. This file intentionally disables fake checkout and does not implement real payment, renewal, or invoice-paid subscription activation.

## Validate configuration without starting services

On a machine with Docker Compose v2:

```sh
docker compose --project-name soundspa-v2-production \
  --profile tools \
  --file docker-compose.production.yml \
  --env-file .env.v2.production.example config --quiet
npm run test:v2:production-config
sh -n deploy/postgres/production-init/10-create-roles.sh
```

The example image digests and credentials are placeholders. The containers have startup guards that reject unresolved `REPLACE_`, `PLACEHOLDER`, or `CHANGE_ME` values before PostgreSQL initialization, app startup, or migration execution. Validation proves Compose interpolation/schema and repository invariants only; it does not prove DNS, Nginx, registry access, image availability, role creation, S3/CDN access, migrations, or service health. Do not start the Compose project as part of validation.

## Immutable staging-to-production promotion

1. Merge reviewed source to `soundspa-v2`; CI runs lint, TypeScript, unit tests, disposable PostgreSQL 16 integration tests, migration validation and production build.
2. Build one production image from that exact commit in CI, push it to the selected registry tagged with the full commit SHA, and record its registry digest/provenance. Do not use `latest` for deployment.
3. Deploy that exact image digest to staging and complete browser/device/catalog/playback/billing acceptance. Record commit, digest, and migration ledger.
4. After approval, set `V2_APP_IMAGE` to the exact same digest in the production env file. Explicitly pull and inspect that digest before any production migration or app update. Never rebuild the image for production.

The repository currently has no registry promotion workflow; the above is a required implementation before the first production release.

## First deployment procedure (future approval required)

### Preflight and backup

1. Confirm SSH host identity, V1/V2 staging service health, production domain/DNS plan, current disk/RAM, registry digest, production Compose project name, and that no deployment is running. Confirm the production env file and media path are production-only.
2. Run Compose `config --quiet`; inspect only sanitized configuration. Confirm app and migrator image references resolve to the approved identical digest, PostgreSQL has no published port, and no staging/V1 mounts or secrets are present. Confirm the production S3 identity is read-only and targets the existing published catalog bucket.
3. Create the isolated production DB by starting **only** `v2-postgres` on the first approved provisioning. Wait for its health check. The init SQL creates restricted roles only on an empty volume. Never remove/reinitialize the volume to rerun init scripts.
4. Before every schema migration on an existing database, create a timestamped encrypted custom-format PostgreSQL dump outside the DB volume, checksum it, inspect with `pg_restore --list`, copy it off-host, and record database identity and the migration ledger. Test restore on an isolated copy before relying on the backup. A fresh empty first-time database has no customer state to back up, but back up immediately after catalog provisioning and before customer onboarding.
5. If a previous production release exists, tag/retain its exact image digest and record the schema version it supports.

### Initial schema and each approved migration

1. Confirm the migration image is the same digest as the accepted staging app, and that the prod migration URL targets the isolated production PostgreSQL service and database `soundspa_v2`.
2. Confirm PostgreSQL health and verified backup. Run one migration container once, with retained logs and exit code, e.g. `docker compose --project-name soundspa-v2-production --file docker-compose.production.yml --env-file /etc/soundspa-v2/production.env --profile tools run --no-deps --pull never --name soundspa-v2-production-migrate-<UTC-ID> v2-migrate`.
3. Verify exit status, database identity, expected ledger row exactly once, expected objects, and application-role access. On failure or ambiguous execution, stop; inspect before any retry. Never manually write the migration ledger.
4. Use expand/contract changes and maintain compatibility with the currently running app. Do not deploy app code that requires a schema change until that migration has been verified.

### App deployment and verification

1. Pull the approved digest explicitly; inspect the local image ID and provenance. Do not build on the production host.
2. Use a separately reviewed Nginx install procedure: back up the active V2 site configuration and metadata; after DNS is confirmed, first install an HTTP-only version containing the ACME challenge location, validate and reload, and obtain the certificate using the configured webroot. Then install this full template. Run `nginx -t` before each reload. The production server block returns 404 for the bundled legacy V1 paths (`/app`, `/ios-player`, `/no-auth`, `/local-preview`, `/api/auth`, and legacy app-data/access/monitoring/Prodamus endpoints); the staging virtual host is unchanged. Never modify the V1 or staging site files.
3. Deploy app only: `docker compose --project-name soundspa-v2-production --file docker-compose.production.yml --env-file /etc/soundspa-v2/production.env up -d --no-deps --force-recreate app`. Do not run `down`, `down -v`, or recreate PostgreSQL.
4. Verify exact running image digest and commit, app health, `/account`, `/login`, `/player`, registration/device token log protections, catalog with an authorized device, real media playback, email magic link, admin login, and logs. The Compose app healthcheck is HTTP liveness only; separately run a read-only DB query from the app container using its configured driver and verify `current_database()` is `soundspa_v2`. Verify the production migration count and container/volume identities remain as expected.
5. Do not create test purchases or claim paid billing works until the approved payment workstream is deployed and tested.

## Rollback and restore

- Keep the current production image and at least three recent **verified** rollback digests with schema compatibility documented. Do not prune images by age alone.
- For an app defect, stop or route traffic away and redeploy the previous compatible image by digest with `up -d --no-deps --force-recreate app`. Keep the DB and media volume intact. Do not automatically restore a DB or downgrade schema.
- For a database/data incident, stop app writes, preserve a fresh copy of the current DB for investigation, and use a separately approved restore plan. Restoring a backup loses writes after its recovery point; reconcile them explicitly. Prefer a tested forward fix for additive migrations.
- Keep V1 and staging services, databases, volumes, ports, and secrets untouched. Do not remove other projects or shared images during rollback.

## Resource, security, and operations

The app service is capped at 1 GiB, matching staging; PostgreSQL has no memory cap in this initial template. Measure host free memory, sustained container usage, disk, DB size, media size, and verified backup size before provisioning. Reserve enough for two independent DBs, production media, a backup outside the DB volume, current plus rollback images, and bounded build cache. The current VPS headroom could not be verified during preparation.

The database port is not published; app and DB use a production-only network. The app is loopback-bound behind Nginx. Secrets and media buckets are environment-specific. Configure Docker log rotation and alerting for app readiness/errors, database availability, disk/RAM, backup age/failure, certificate expiry, and offline salons. Add telemetry retention/archival before production growth.

No production DNS, TLS, containers, volumes, database, migrations, or deployments were created by preparing this configuration.
