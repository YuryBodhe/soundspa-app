import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const compose = resolve(root, "docker-compose.production.yml");
const envFile = resolve(root, ".env.v2.production.example");
const output = spawnSync("docker", ["compose", "--project-name", "soundspa-v2-production", "--profile", "tools", "--file", compose, "--env-file", envFile, "config", "--format", "json"], {
  cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
});
assert.equal(output.status, 0, `Docker Compose config validation failed: ${output.stderr || output.error?.message || "unknown error"}`);
const config = JSON.parse(output.stdout);
assert.equal(config.name, "soundspa-v2-production");
assert.deepEqual(Object.keys(config.services).sort(), ["app", "v2-migrate", "v2-postgres"]);
assert.ok(Object.values(config.services).every((service) => !service.build), "production services must use images, never build locally");

const app = config.services.app;
const migrate = config.services["v2-migrate"];
const postgres = config.services["v2-postgres"];
assert.match(app.image, /@sha256:[a-f0-9]{64}$/);
assert.match(postgres.image, /postgres:16-alpine@sha256:[a-f0-9]{64}$/);
assert.equal(migrate.image, app.image, "migration and application must use the same immutable release image");
assert.equal(app.container_name, "soundspa-v2-production-app");
assert.equal(postgres.container_name, "soundspa-v2-production-postgres");
assert.deepEqual(app.ports, [{ mode: "ingress", target: 3000, published: "3102", host_ip: "127.0.0.1", protocol: "tcp" }]);
assert.equal(postgres.ports, undefined, "PostgreSQL must not publish a host port");
assert.equal(postgres.environment.POSTGRES_DB, "soundspa_v2");
assert.equal(app.environment.V2_DEPLOYMENT_ENV, "production");
assert.equal(app.environment.V2_FAKE_PROVIDER_ENABLED, "0");
assert.match(app.environment.V2_DATABASE_URL, /@v2-postgres:5432\/soundspa_v2$/);
assert.match(migrate.environment.V2_DATABASE_URL, /soundspa_v2_migrator:.*@v2-postgres:5432\/soundspa_v2$/);
assert.equal(app.environment.V2_MEDIA_STORAGE_BACKEND, "s3");
assert.equal(app.environment.V2_MEDIA_FINALIZE_MODE, "s3-only");
assert.equal(app.environment.V2_MEDIA_DELIVERY_BACKEND, "cdn");
assert.equal(app.environment.V2_MEDIA_CDN_BASE_URL, "https://media.soundspa.bodhemusic.com");
assert.ok(postgres.volumes.some((mount) => mount.type === "volume" && mount.source === "v2-production-pgdata"));
assert.equal(config.volumes["v2-production-pgdata"].name, "soundspa-v2-production-pgdata");
assert.ok(app.volumes.some((mount) => mount.type === "bind" && mount.source === "/var/lib/soundspa-v2-production-media"));

function runShellGuard(script, env) {
  return spawnSync("/bin/sh", ["-ec", script], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
}
const appGuard = runShellGuard(app.command.at(-1), {
  V2_DATABASE_URL: "postgresql://soundspa_v2_app:REPLACE_PASSWORD@v2-postgres:5432/soundspa_v2",
  V2_ADMIN_USERNAME: "REPLACE_OPERATOR", V2_ADMIN_PASSWORD: "REPLACE_PASSWORD",
});
assert.equal(appGuard.status, 78, "app must reject unresolved secrets before starting Next.js");
assert.doesNotMatch(appGuard.stderr + appGuard.stdout, /REPLACE_PASSWORD/);
const postgresGuard = runShellGuard(postgres.command[0], {
  POSTGRES_PASSWORD: "REPLACE_OWNER_PASSWORD", V2_APP_DB_PASSWORD: "REPLACE_APP_PASSWORD", V2_MIGRATION_DB_PASSWORD: "REPLACE_MIGRATION_PASSWORD",
});
assert.equal(postgresGuard.status, 78, "PostgreSQL must reject unresolved passwords before initdb");
assert.doesNotMatch(postgresGuard.stderr + postgresGuard.stdout, /REPLACE_(?:OWNER|APP|MIGRATION)_PASSWORD/);
const migrationGuard = runShellGuard(migrate.command.at(-1), {
  V2_DATABASE_URL: "postgresql://soundspa_v2_migrator:REPLACE_PASSWORD@v2-postgres:5432/soundspa_v2",
});
assert.equal(migrationGuard.status, 78, "migration runner must reject unresolved secrets before migration execution");
assert.doesNotMatch(migrationGuard.stderr + migrationGuard.stdout, /REPLACE_PASSWORD/);

const nginx = readFileSync(resolve(root, "deploy/nginx/soundspa2.bodhemusic.com.conf"), "utf8");
assert.equal((nginx.match(/server_name soundspa2\.bodhemusic\.com;/g) ?? []).length, 2);
assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3102/);
assert.match(nginx, /access_log off;[\s\S]{0,80}error_log \/dev\/null emerg;/);
assert.match(nginx, /\/var\/lib\/soundspa-v2-production-media\/artwork\//);
assert.doesNotMatch(nginx, /3101|test\.soundspa\.bodhemusic\.com/);
for (const path of ["/app/", "/ios-player/", "/no-auth/", "/local-preview/", "/api/auth/", "/api/app-data", "/api/check-app-access", "/api/monitoring/ping", "/api/webhooks/prodamus"]) {
  assert.ok(nginx.includes(`location ^~ ${path}`) || nginx.includes(`location = ${path}`), `legacy path must be disabled on production host: ${path}`);
}

const envExample = readFileSync(envFile, "utf8");
assert.doesNotMatch(envExample, /(?<!REPLACE_WITH_)(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})/);
const envValues = Object.fromEntries(envExample.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")]; }));
assert.ok(Object.entries(envValues).filter(([key]) => key.includes("PASSWORD") || key.includes("SECRET") || key.includes("API_KEY") || key.includes("ACCESS_KEY_ID")).every(([, value]) => value.startsWith("REPLACE_")));

console.log("PASS: Compose is isolated and digest-pinned; runtime guards reject placeholder DB/app/migration secrets; fake checkout is forced off; media is configured read-only against the published CDN catalog; V1 routes are denied only in the production vhost.");
