# SoundSpa V2 — Worker Context

Last updated: 2026-09-17

This file is the authoritative current operational context for SoundSpa V2.

Read this file before starting a SoundSpa V2 task.

Do not reconstruct project history unless the current task specifically requires it.
Do not read historical handoffs/checkpoints by default.
Inspect only files relevant to the current task.

---

## 1. Role

You are the execution worker for SoundSpa V2.

The owner/supervisor defines architecture, priorities, scope, and acceptance criteria.

Your job is to:

- understand the requested task;
- inspect only the relevant implementation;
- make the smallest necessary change;
- verify it appropriately;
- report the result concisely.

Do not expand task scope without explicit approval.

Do not refactor already accepted systems unless the task specifically requires it.

If a task reveals a materially broader architectural issue, stop and report it instead of silently expanding scope.

---

## 2. Repository and Worktrees

GitHub repository:

YuryBodhe/soundspa-app

Branch:

soundspa-v2

Local Mac V2 worktree:

/Users/bodhem3/Zavod/apps/soundspa-v2

Server V2 staging repository:

/var/www/soundspa-v2

Original/legacy local checkout:

/Users/bodhem3/Zavod/apps/soundspa-app

Production server repository:

/var/www/soundspa

The local V2 worktree, origin/soundspa-v2, and staging repository are synchronized through Git.

Do not create duplicate project copies.

---

## 3. Production Safety

PRODUCTION IS OFF LIMITS unless the owner explicitly authorizes a production action.

Production path:

/var/www/soundspa

Production currently serves active SoundSpa clients.

Never:

- deploy V2 to production automatically;
- restart production containers;
- modify production nginx;
- modify the production database;
- modify production media;
- switch production Git state;
- perform a production migration;

unless explicitly instructed to do so.

A successful staging test is NOT authorization for production deployment.

---

## 4. Staging

Staging URL:

https://test.soundspa.bodhemusic.com/v2

Staging repository:

/var/www/soundspa-v2

Staging app bind:

127.0.0.1:3101

Staging is isolated from the production application.

For normal V2 deployment, recreate only what is required.

Do not restart PostgreSQL or unrelated containers without a specific reason.

After staging deployment, verify /v2 health.

---

## 5. Current Accepted Baseline

Current owner-accepted baseline commit:

e8af296dfdd7913f027cd8b97fb45039b5c43b14

At this baseline:

- music playback is owner-accepted;
- iPhone/Safari startup and recovery behavior is accepted;
- Resume Playback is accepted;
- resumable large-file upload is accepted;
- ambient playback is owner-accepted;
- ambient N=1 playback is accepted;
- ambient N>1 playlist playback is accepted;
- ambient playback with the iPhone screen off is accepted;
- temporary ambient overlap diagnostics have been removed.

At acceptance, staging contained:

- 11 channels;
- 29 tracks;
- Access data: 0/0.

These counts are informational and may change as content is managed.
They are not application invariants.

---

## 6. Playback — Protected Accepted Behavior

Playback is considered stable.

Do not redesign, refactor, or “improve” accepted playback behavior as part of unrelated work.

Playback changes require an explicit playback task.

### Music

Primary implementation:

app/lib/audio/mp3Engine.ts

Related music systems include:

app/lib/audio/musicSessionCache.ts
app/lib/audio/musicResumeStore.ts

Accepted music behavior includes:

- progressive HTTPS playback;
- startup based on usable buffered media;
- shared completed-Blob session cache;
- Resume Playback;
- startup/recovery safeguards;
- buffering state;
- playback-priority safeguards;
- DB-backed playlists;
- sequential music-track transitions.

Ordinary music channels reuse the same generic playback engine/cache architecture.

Do not introduce channel-specific playback engines.

Music crossfade is not currently required.

Sequential transitions between normal music tracks are accepted.

### Critical Music Recovery Invariant

The following do NOT prove successful playback or recovery:

- availability or growth of `audio.buffered`;
- `canplay`;
- `playing`;
- a resolved `audio.play()` Promise;
- `navigator.onLine`.

An exhausted HTMLAudioElement may report apparently healthy browser state while playback remains frozen.

Only observable genuine `currentTime` progression confirms successful playback/recovery.

Do not weaken this invariant.

### Playback Priority

Audible playback continuity always has priority over background Blob caching.

Do not weaken cache-admission, yield, cooldown, or related playback-priority safeguards merely to make background Blob preparation finish sooner.

On a weak connection, postponing or aborting background cache preparation is preferable to threatening audible playback.

---

## 7. Ambient Playback

Primary implementation:

app/lib/audio/ambientEngine.ts

Current accepted ambient architecture:

- persistent A/B Audio decks;
- maximum two persistent playback decks for the A/B transport;
- 5-second overlap;
- baked fades in source audio files;
- no programmatic gain crossfade;
- watchdog retained;
- sequential fallback retained;
- N=1 self-overlap supported;
- N>1 playlists with different tracks supported;
- progressive/background Blob preparation as implemented by the accepted engine.

The persistent A/B architecture exists primarily to preserve reliable Safari/iPhone playback lifecycle behavior.

Owner acceptance was performed on a real iPhone Safari.

The accepted tests include:

- repeated seamless transitions;
- 5-second audible overlap;
- N=1;
- N>1 with different ambient files;
- playback with the screen off.

Do not change:

- persistent A/B lifecycle;
- 5-second overlap;
- watchdog;
- sequential fallback;

without explicit instruction.

Temporary ambient overlap diagnostics were removed at the accepted baseline.

Do not reintroduce them unless a new investigation requires diagnostics.

---

## 8. Content Model

Use one unified content model:

Channel → Tracks

Do not introduce artificial content types such as:

- shortTrack;
- longTrack;
- mix;

merely because media durations differ.

A Channel may contain:

- normal music tracks;
- long-form music;
- ambient/noise tracks.

Player behavior may adapt where appropriate, but the data model remains unified.

Current product direction includes:

- create channels;
- archive channels;
- add/upload tracks;
- remove/archive tracks where appropriate;
- reorder tracks;
- enable/disable tracks;
- artwork management;
- publishing workflow.

Customer subscriptions, payments, and final customer authentication are later-stage work unless explicitly requested.

---

## 9. V2 Database

SoundSpa V2 uses a separate PostgreSQL database with Drizzle ORM.

The V2 database is the canonical source of truth for V2 application data.

Do not modify the V1 database/schema.

The V2 model includes:

Organization → Locations

Users access organizations through memberships.

Devices belong to Locations.

Channel entitlements are Location-level.

Important conventions:

- UUID IDs;
- relation IDs instead of slugs;
- timestamptz;
- archive/disable preferred over destructive deletion where appropriate;
- restrictive foreign keys where appropriate;
- multiple organization owners allowed;
- globally unique location slug;
- lowercase unique email;
- roles: owner | admin | manager;
- channel kind: music | ambient;
- entitlement: included | preview | subscribed;
- media `storage_key` is immutable.

Do not create a DB migration unless the task actually requires a schema change.

Do not modify data merely because a task involves reading or inspecting the database.

---

## 10. Media

Canonical current V2 media storage:

/var/lib/soundspa-v2-media/

Media categories include:

- music;
- ambient;
- artwork.

Media files are not stored in Git.

Do not casually rename, mutate, or reuse immutable storage keys.

Current application/database architecture separates logical media storage keys from physical hosting.

A future S3/CDN migration is planned.

It is NOT part of the current architecture unless explicitly requested.

Do not begin S3/CDN migration as part of unrelated content or playback work.

---

## 11. Content Admin

V2 Content Admin exists under:

/app/admin/channels/v2

Protected V2 admin APIs exist under:

/api/v2/admin/content

Current operator protection uses temporary V2 Basic Auth.

This operator protection is separate from future customer authentication.

The Content Admin is currently an operator tool.
Polished customer-facing admin UX is not a prerequisite for current content-management work.

---

## 12. Resumable Upload

Large-file upload uses resumable upload sessions.

Accepted properties include:

- 512 KiB chunks;
- bounded requests;
- durable server-confirmed offsets;
- reconnect/resume;
- duplicate chunk safety;
- idempotent finalize;
- validation/media-processing safeguards;
- safe handling of incomplete uploads.

The resumable upload system has been owner-tested with a real large Spaquatoria file.

Do not replace it with a simple single-request upload.

Do not redesign it merely because a temporary browser/network failure occurs.

Investigate browser, network, nginx, application, and upload-session state before changing accepted upload architecture.

---

## 13. Git Safety

Before any code change:

- confirm the repository;
- confirm branch;
- inspect HEAD;
- run/check `git status`;
- inspect any current diff.

Expected branch:

soundspa-v2

Preserve unrelated existing changes.

Never clean, reset, discard, overwrite, or incorporate unrelated work without explicit approval.

When commit/push is requested:

- commit only task-related changes;
- use a descriptive commit message;
- push to `origin/soundspa-v2`;
- report the full commit hash.

Do not create a Git commit for a read-only investigation or backup task unless repository content genuinely changes.

---

## 14. Task Safety Rules

For every task:

1. Read this file first.
2. Verify Git state.
3. Inspect only files relevant to the task.
4. Make the smallest necessary change.
5. Preserve accepted behavior outside task scope.
6. Do not touch production.
7. Do not restart unrelated services.
8. Do not modify DB/media unless required by the task.
9. Do not perform opportunistic refactors.
10. Do not add dependencies unless necessary.
11. Do not reconstruct project history unless required.
12. Do not read large historical documents by default.

If something unexpected is discovered, report it instead of silently broadening the task.

---

## 15. Verification

Verification should be proportional to the change.

Do not run unrelated expensive checks solely out of habit if they provide no meaningful coverage for the current change.

For ordinary application/code changes, normally use:

- TypeScript check;
- relevant regression tests;
- `git diff --check`.

Run a production build when:

- the change can affect application build/runtime;
- deployment requires it;
- or the task explicitly requests it.

For playback changes:

- run relevant music and/or ambient regressions;
- preserve accepted playback invariants.

For DB/schema changes:

- verify schema/migration consistency;
- verify only the intended migration/data effects.

For deployment:

- verify staging health;
- verify only intended services/containers changed.

Owner/browser acceptance is separate from automated verification when real-device behavior matters.

---

## 16. Deployment

Unless explicitly stated otherwise:

STAGING ONLY.

Production must remain untouched.

Before staging deployment:

- confirm intended commit/state;
- confirm clean or understood working tree.

After staging deployment:

- verify `/v2`;
- verify staging health;
- verify only intended containers/services changed;
- report the result.

Do not deploy to production after staging acceptance without separate explicit authorization.

---

## 17. Backups and Checkpoints

Existing server V2 backup root:

/var/backups/soundspa-v2/

Existing Mac V2 backup root:

/Users/bodhem3/Zavod/BACKUPS/SoundSpa-v2/

A full V2 checkpoint should normally contain:

- V2 PostgreSQL dump;
- complete relevant V2 media archive;
- manifest/metadata;
- accepted Git commit;
- SHA-256 checksums;
- enough information to identify and restore the checkpoint later.

Checkpoint verification should confirm:

- expected files exist;
- DB dump is non-empty and valid;
- media archive is non-empty;
- checksums match;
- copied backup matches the source.

Backup/checkpoint tasks must not modify application state.

Do not restart containers merely to create a checkpoint.

---

## 18. Historical Context

Historical operational handoffs/checkpoints exist under:

docs/checkpoints/

Example:

docs/checkpoints/2026-09-04_1431_HANDOFF.md

These documents are historical snapshots.

They may contain:

- obsolete commit hashes;
- old channel/track counts;
- superseded implementation details;
- diagnostics that have since been removed;
- old next-step recommendations.

Do not read historical handoffs by default.

Use them only when a task specifically requires investigation of:

- an older implementation;
- a previous architectural decision;
- an incident;
- a regression;
- a historical checkpoint.

This `WORKER_CONTEXT.md` is the authoritative source for the current operational state.

Current code and current Git state remain authoritative for implementation details.

---

## 19. Context and Credit Efficiency

Keep context usage focused.

For a normal task:

1. Read this file.
2. Read the user's current task.
3. Inspect only relevant files.
4. Use Git history only when necessary.
5. Open historical documentation only when necessary.

Do not preload or summarize the entire project history.

Do not inspect unrelated subsystems “for completeness.”

Prefer targeted searches and targeted file reads over broad repository-wide analysis.

Keep reports concise.

---

## 20. Reporting

Final task reports should normally state:

- what changed;
- what was deliberately not changed;
- verification performed;
- commit hash, if applicable;
- staging deployment status, if applicable;
- unexpected issues;
- remaining owner acceptance, if applicable.

Do not repeat the entire project history.

Do not produce long explanations of unchanged architecture unless requested.

---

## 21. Current Product Direction

The core playback foundation is considered accepted.

Current development should increasingly focus on making SoundSpa a usable content product rather than repeatedly redesigning playback.

Near-term direction:

Channel management
→ Track management
→ Ordering / enable-disable
→ Artwork
→ Publish workflow
→ Real content population

Later stages include:

- customer authentication;
- subscriptions;
- payments;
- customer/device management expansion;
- S3/CDN migration when explicitly scheduled.

Do not automatically start any of these stages.
Work only on the currently assigned task.