# SoundSpa — Project Context

> **Canonical high-level context for the SoundSpa project.**
>
> This document describes the current product concept, architecture, infrastructure, major subsystems, known legacy areas, and important risks. Keep it updated whenever the architecture, infrastructure, data model, streaming model, or major product behavior changes.
>
> **Last updated:** 2026-08-25

## 1. Product overview

**SoundSpa** is a B2B music streaming service for SPA salons and wellness businesses.

The core product concept is a curated set of continuous music channels/playlists designed for different SPA contexts and moods. Examples include:

- Relax SPA
- Dynamic SPA
- 432 Hz
- thematic / seasonal playlists
- other curated SPA-focused music selections

A client chooses one main music channel and can simultaneously add a separate ambient nature/noise layer, for example:

- sea
- forest
- rain
- night / nature ambience

The music layer and ambient layer are independently controlled, allowing a salon to create its own combined sound environment.

The service is multi-tenant: each salon/business is represented as a tenant and can have its own users, channel availability and subscription state.

## 2. High-level architecture

```text
Client browser / SPA salon device
            |
            v
        Nginx / HTTPS
            |
            v
      Next.js application
      (SoundSpa App)
       /           \
      v             v
 PostgreSQL       Audio playback
      |             |
      |             +--> AzuraCast music streams
      |             +--> Ambient/noise layer
      |
      +--> Auth / tenants / channels / billing / monitoring
      |
      +--> Background worker
                |
                +--> monitoring
                +--> scheduled jobs
                +--> Telegram notifications
                +--> AI reports / analysis
```

At present, **SoundSpa App and AzuraCast are hosted on the same Timeweb VPS in Moscow, Russia**.

## 3. Current technology stack

### Application

- Next.js 16
- React 19
- TypeScript
- Next.js App Router
- Next.js Route Handlers for backend/API functionality
- Server Components and client components

There is currently no separate Express/Nest backend. The main web backend is part of the Next.js application.

### Database

- PostgreSQL 15
- Drizzle ORM
- Drizzle Kit for migrations/schema tooling

PostgreSQL is the current production database. SQLite exists only as legacy/historical material and should not be treated as the current production data store.

### Infrastructure

- Timeweb VPS, Moscow
- Docker / Docker Compose
- Nginx
- Let's Encrypt certificates
- GitHub Actions deployment
- Node.js 20-based application containers

### Background processing

- Separate Node.js worker process
- `node-cron`
- PostgreSQL-backed monitoring/notification data

## 4. Streaming architecture

### 4.1 Main music channels

Continuous music channels are currently delivered through **AzuraCast** running on the same Timeweb VPS as the SoundSpa application.

A channel represents a curated music selection / radio-style stream. Channel metadata is stored in PostgreSQL, including a `streamUrl` used by the client player.

Conceptually:

```text
Curated music library / playlists
            |
            v
        AzuraCast
            |
      continuous streams
            |
            v
       SoundSpa player
```

The current product model is intentionally channel-oriented rather than track-selection-oriented: the salon chooses a curated channel and SoundSpa handles continuous playback.

### 4.2 Ambient layer

SoundSpa supports a second simultaneous audio layer for ambient nature/noise sounds such as sea, forest and rain.

The ambient layer is independent from the main music channel. This allows combinations such as:

```text
Relax SPA + Sea
432 Hz + Forest
Dynamic SPA + Rain
```

Some ambient audio assets currently exist under `public/noise/`.

### 4.3 Browser audio engine

The main browser playback logic is implemented in:

`app/lib/soundEngine.ts`

The engine currently uses browser `HTMLAudioElement` instances and maintains separate audio elements/state for:

1. main music stream;
2. ambient/noise layer.

The engine includes:

- play / stop
- independent volume control
- fade-in / fade-out
- channel switching
- stream stall detection
- watchdog logic
- automatic silent reconnect
- buffering state
- client/session identification
- player heartbeat monitoring

The watchdog periodically checks whether playback time is progressing and attempts to reconnect a stalled music stream.

The project also contains `hls.js` and `howler` dependencies, but the current core playback engine is primarily based on native `HTMLAudioElement` behavior.

## 5. Multi-tenant model

SoundSpa is a multi-tenant SaaS application.

Primary entities include:

- `tenants` — SPA salons / customer accounts
- `users` — users associated with tenants
- `channels` — global music/ambient channel catalog
- `tenant_channels` — channels available to a specific tenant
- `payments` — payment records
- `invites` — signup invitation codes
- `login_tokens` — magic-link authentication tokens

A tenant has its own identity/slug, users, channel configuration and subscription state.

## 6. Authentication

Current customer authentication is based on **magic links**.

General flow:

```text
email / signup
     |
     v
login token created
     |
     v
magic-link email
     |
     v
consume token
     |
     v
soundspa_session cookie
     |
     v
/app/<tenantSlug>
```

Magic-link email delivery currently uses AgentMail.

There is also a separate admin authentication area.

### Known security issue — session integrity

The current `soundspa_session` token is Base64URL-encoded JSON but is not cryptographically signed. `SESSION_SECRET` exists in the code but is not currently used to authenticate the session payload.

This means session integrity must be fixed as a high-priority security task. The session should be replaced with a signed/authenticated mechanism and existing production sessions invalidated as appropriate during migration.

## 7. Subscription and billing

Current billing integration uses **Prodamus**.

Important tenant subscription fields include:

- `trialStartedAt`
- `trialEndsAt`
- `paidTill`

At a high level the application derives access state as:

```text
trial -> active/paid -> expired
```

The codebase includes Prodamus webhook/subscription handling and a `payments` table.

## 8. Monitoring

The SoundSpa player sends periodic heartbeat information to the application.

Typical heartbeat information includes:

- tenant ID
- player status
- session ID
- selected music channel
- selected noise/ambient channel
- client type
- user agent
- buffering state
- player version

The application uses this information to determine whether salon players are online/offline and to build operational monitoring data.

Conceptually:

```text
SoundSpa player
      |
      | heartbeat
      v
/api/monitoring/ping
      |
      v
PostgreSQL
      |
      v
background worker
      |
      +--> online/offline state
      +--> reports
      +--> notifications
```

## 9. Background worker

A separate worker is implemented in `scripts/worker.ts` and runs independently from the main Next.js web process.

Current responsibilities include:

- monitoring cleanup
- tenant analytics/report generation
- detecting offline tenants
- batching login notifications
- processing the Telegram notification queue
- daily summary/report generation

This worker is an important architectural boundary and should remain separate from latency-sensitive web requests unless there is a reason to redesign it.

## 10. Notifications

Telegram is currently used for operational/admin notifications.

The project contains a PostgreSQL-backed Telegram queue with retry handling. This avoids coupling all Telegram delivery directly to interactive user requests.

## 11. AI / automation layer

The repository contains an AI/automation layer under `lib/ai/` and related database schemas.

Current use includes tenant reports, daily summaries and monitoring-derived analysis.

This subsystem should be treated as auxiliary operational intelligence rather than part of the core audio playback path: failure of AI/reporting must not prevent salons from playing music.

## 12. Deployment

The main deployment flow is GitHub Actions -> SSH -> Timeweb VPS.

A push to `main` triggers deployment. The server checkout is located under `/opt/soundspa-app` and deployment rebuilds/restarts Docker services.

Current high-level production topology:

```text
                    Timeweb VPS — Moscow

                       Internet
                          |
                          v
                       Nginx
                          |
               +----------+----------+
               |                     |
               v                     v
          SoundSpa App            AzuraCast
            Next.js              music streams
               |
       +-------+-------+
       |               |
       v               v
   PostgreSQL         Worker
```

Both the SoundSpa application and AzuraCast currently reside on this same VPS.

## 13. Current database schema direction

The production direction is PostgreSQL + Drizzle.

The repository contains older SQLite-related code/artifacts and SQL dumps from previous development/migration phases. These should be treated as legacy unless explicitly confirmed otherwise.

Current key schema is centered around `db/schema.pg.ts` plus additional schemas under `db/schema/`.

## 14. Known legacy / cleanup areas

The repository contains historical artifacts from earlier iterations, including some of the following:

- SQLite / `better-sqlite3` remnants
- old database dumps
- backup files such as `.bak*`
- overlapping/older Drizzle configuration/schema artifacts
- older admin/player code paths or historical duplicates
- dependencies from earlier implementation approaches

These should be reviewed gradually. Do not delete legacy files simply because they look unused; verify runtime/import/deployment dependencies first.

## 15. Known risks and technical debt

### Priority 1 — session security

The customer session payload is currently not cryptographically signed/authenticated. This is a critical authorization risk.

### Priority 1 — database credentials

Production-like PostgreSQL credentials have been committed in Docker Compose configuration. Treat exposed credentials as compromised: rotate them and move secrets to appropriate environment/secrets storage.

### Priority 1 — PostgreSQL exposure

The Docker configuration publishes PostgreSQL port `5432`. Verify whether public exposure is required. Production DB access should normally be restricted to trusted hosts/networks/services.

### Priority 2 — repository cleanup

Identify and remove/archive obsolete SQLite files, dumps, backup source files, duplicated configuration and unused dependencies after verifying they are not used by production.

### Priority 2 — architecture documentation drift

Older architecture documents may describe previous states of the project. This `docs/PROJECT_CONTEXT.md` file is the canonical high-level architecture/context document going forward.

## 16. Architectural principles going forward

Unless future requirements justify a change:

1. Avoid a full rewrite simply for technology modernization.
2. Keep the existing Next.js + PostgreSQL + Drizzle foundation while improving it incrementally.
3. Keep audio playback reliable and independent from non-critical AI/reporting systems.
4. Treat continuous playback reliability as a core product requirement.
5. Preserve the multi-tenant model.
6. Keep background/slow operational work outside interactive web requests where practical.
7. Treat infrastructure/security cleanup as part of reconstruction, not as optional polish.
8. Document major architecture decisions and update this file when the real system changes.

## 17. Source-of-truth hierarchy

For future work, use the following hierarchy:

1. **Running production behavior and current code** — source of truth for actual implementation.
2. **Current Drizzle/PostgreSQL schema and migrations** — source of truth for persisted data structure.
3. **`docs/PROJECT_CONTEXT.md`** — source of truth for high-level architecture and product context.
4. Older architecture documents, dumps and backups — historical reference only unless verified against current code.

## 18. Current reconstruction stage

The project is entering a reconstruction/modernization phase.

The immediate goal is **not** to redesign everything at once. The first stage is to establish a reliable shared understanding of the existing system, identify obsolete parts and security/operational risks, and then define the desired improvements before changing architecture.

Future proposed architecture should therefore distinguish clearly between:

- **CURRENT** — what is actually running now;
- **LEGACY** — old code/data/configuration no longer part of the intended system;
- **TARGET** — improvements that have been agreed but not yet implemented.
