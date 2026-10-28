# SoundSpa V2 — Worker Operations

> Operational runbook for ChatGPT Work agents. Keep this file concise and update it after verified infrastructure changes. **Never store secrets here.**

## 1. Environments and boundaries

| Environment | Purpose | Known location |
| --- | --- | --- |
| Local MacBook | Human operator's development machine; local files and SSH configuration may differ from Work | Paths and permissions **must be discovered**, not assumed |
| ChatGPT Work | Agent development, testing, GitHub operations and approved remote actions | Sandbox SSH networking may be blocked; an explicitly approved elevated connection has worked |
| Timeweb staging server | SoundSpa **V2 staging** | SSH alias `Soundspa-Moscow`; checkout `/var/www/soundspa-v2` |
| SoundSpa V1 | Live production, AzuraCast | **Out of scope. Do not modify.** |

V2 staging URL: `https://test.soundspa.bodhemusic.com`.
V2 branch: `soundspa-v2`.

## 2. SSH access

- Existing SSH alias: `Soundspa-Moscow`, port 22; key authentication configured with `~/.ssh/id_ed25519_soundspa` **in the environment where that configuration exists**.
- The Work sandbox's normal SSH connection may fail with `Operation not permitted` at the network layer. An **approved elevated** SSH connection was verified to work. Do not assume persistent unattended access.
- Existing remote SSH login is `root` (UID 0), **high privilege**. Use it only for explicitly approved, narrowly scoped tasks. Longer-term goal: a dedicated deployment account and root-owned restricted deployment wrapper, without unrestricted Docker-group access.
- Never read, print, transmit or commit private keys, tokens, passwords or `.env` contents.
- Before any remote operation verify hostname, user, checkout, branch and intended environment. Never confuse V1 with V2.

## 3. Local MacBook workflow

- MacBook and Work are distinct execution environments. A path, credential, app or SSH alias available on one may not exist on the other.
- First discover the actual local repository path, Git remote, branch, installed runtimes and SSH configuration; do not invent paths or assume local terminal access.
- Prefer the worker's own checked-out repository for code changes. Use MacBook-specific actions only when explicitly requested and access is actually available.
- Do not copy private keys from MacBook into Work or the repository to solve connectivity issues.

## 4. GitHub / development

1. Confirm repository identity, branch `soundspa-v2`, `git status --short`, and `git rev-parse HEAD`.
2. Make only approved changes; preserve unrelated untracked files. The worker checkout has contained `scripts/v2/reset-staging-customer-data.ts` and `scripts/v2/test-reset-staging-customer-data-db.ts`; never run or alter them without separate explicit authorization.
3. Run relevant tests, TypeScript, scoped lint and `git diff --check`; inspect migration files and Drizzle journal when applicable.
4. Commit descriptive changes and push to `origin/soundspa-v2` only when authorized. Report the full commit SHA and tests.
5. Never force-push or silently discard local changes.
6. Before deployment, fetch remote and verify the approved target SHA and fast-forward ancestry. Fast-forward only; never reset a dirty staging checkout.

## 5. V2 staging deployment configuration

- Checkout: `/var/www/soundspa-v2`.
- Compose: `docker-compose.staging.yml`, env file `.env.v2`, project `soundspa-v2`.
- Main services: `app`, `v2-postgres`. Migration runner: `v2-migrate` under Compose profile `tools` (verified for migration `0028`).
- PostgreSQL database: `soundspa_v2`. Migration command is the **V2-specific** Drizzle migrator; never run a V1 migration command.
- Docker commands can affect other services when executed as root. Scope every operation to the V2 project and named service. Do not run Docker prune, `--remove-orphans`, or broad cleanup.

## 6. Supervised deployment procedure

**Approval gates are mandatory.** Do not infer permission to migrate or restart from permission to push code.

### Phase A — preflight, backup and source

1. Verify server identity, branch, clean checkout, current app image and V2 database health/identity.
2. Create a unique timestamped V2-only `pg_dump -Fc` backup outside the database volume, under `/var/backups/soundspa-v2/`. Check file size and SHA-256. The staging host does not have a host-installed `pg_restore`; run the archive listing check with the PostgreSQL client already in the V2 container, without starting or modifying a service:

```bash
BACKUP_DIR=/var/backups/soundspa-v2/<UNIQUE_BACKUP_ID>
DUMP="$BACKUP_DIR/soundspa_v2.dump"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
umask 077
docker compose --project-name soundspa-v2 \
  --file docker-compose.staging.yml --env-file .env.v2 \
  exec -T v2-postgres pg_dump -U soundspa_v2 -d soundspa_v2 -Fc \
  > "$DUMP"
test -s "$DUMP"
chmod 0600 "$DUMP"
sha256sum "$DUMP" > "$DUMP.sha256"
sha256sum --check "$DUMP.sha256"
docker compose --project-name soundspa-v2 \
  --file docker-compose.staging.yml --env-file .env.v2 \
  exec -T v2-postgres pg_restore --list < "$DUMP" \
  > "$BACKUP_DIR/pg_restore-list.txt"
test -s "$BACKUP_DIR/pg_restore-list.txt"
chmod 0600 "$DUMP.sha256" "$BACKUP_DIR/pg_restore-list.txt"
```

A successful archive listing is not a full restore test. Keep the backup directory and files restricted to root (directory mode `0700`, files `0600`).
3. **Before building a replacement image**, tag the image ID of the *currently running* V2 app with a unique rollback tag. Verify tag digest; do not rely on a previous `latest` image surviving a build.
4. Fetch the approved target commit, verify exact SHA and fast-forward relationship, then fast-forward only. Verify migration SQL and journal.
5. Report and stop at the migration approval gate.

### Phase B — V2 migration (separate approval)

1. Verify backup, rollback tag, Git SHA, database identity, PostgreSQL health and current migration ledger.
2. Review the exact pending SQL and journal entry. If an unexpected migration is pending, **stop**.
3. Build the configured V2 migration runner and execute the approved migration once. For example, the verified migration-0028 pattern was:

```bash
docker compose --project-name soundspa-v2 \
  --file docker-compose.staging.yml --env-file .env.v2 \
  --profile tools build v2-migrate

docker compose --project-name soundspa-v2 \
  --file docker-compose.staging.yml --env-file .env.v2 \
  --profile tools run --no-deps --pull never \
  --name soundspa-v2-migrate-<UNIQUE_RUN_ID> v2-migrate
```

4. Record exit code and logs; verify ledger, schema and PostgreSQL health. If result is ambiguous, inspect first; **never blindly rerun**.
5. Report and stop at the app-deployment approval gate.

### Phase C — build, deploy and verify (separate approval)

```bash
cd /var/www/soundspa-v2

docker compose --project-name soundspa-v2 \
  --file docker-compose.staging.yml --env-file .env.v2 build app

docker compose --project-name soundspa-v2 \
  --file docker-compose.staging.yml --env-file .env.v2 \
  up -d --no-deps --no-build --force-recreate app
```

Verify new app image ID, unchanged PostgreSQL container identity, healthy database, migration ledger, Git SHA, app logs, and HTTP 200 for `/account`, `/login`, `/player`. Unauthenticated admin endpoints may return 401 as expected. Verify actual admin functionality with authorized UI testing. Do not change real promo codes as a smoke test.

## 7. Rollback and failure handling

- Stop and report unexpected state, failed checks, uncertain migration outcomes or security concerns. Do **not** automatically roll back without approval.
- Preserve a V2 database backup and the pre-deploy app image. An image rollback **does not reverse schema or business-data changes**.
- Specifically for Spaquatoria archiving (`0028`): old app code may not enforce archived-code redemption restrictions. After any code is archived, rolling back only the app could be unsafe. Plan a forward fix or a supervised mitigation before rollback.
- Never touch V1 to repair a V2 issue.

## 8. Reporting checklist

Every worker report should state: environment, branch/full SHA, exact operations performed, tests or checks, backup path and verification (when applicable), image IDs and rollback tag (when applicable), database migration ledger, service/HTTP health, warnings, and any operation deliberately **not** performed.

## 9. Known verified baseline (2026-10-28)

- V2 staging deployed at commit `10a2622a01f7c6b81b088fb0632022660c63ae1c`.
- Running app image after Phase C: `sha256:aa1a3af82a8d08f5a0869dfae1931dd63d497652945bc11a790eb448ebdbaa68`.
- Migration ledger: 29 entries through `0028`.
- Rollback tag: `soundspa-v2-app:rollback-spaquatoria-0028-20261028T135832Z`.
- Backup: `/var/backups/soundspa-v2/spaquatoria-0028-20261028T135832Z/soundspa_v2.dump`.
- These are historical verification details, **not guaranteed current state**. Always recheck.
