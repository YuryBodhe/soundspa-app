import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dockerignore = await readFile(new URL("../../.dockerignore", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../../Dockerfile", import.meta.url), "utf8");
const stagingCompose = await readFile(new URL("../../docker-compose.staging.yml", import.meta.url), "utf8");

const resetOnlyScripts = [
  "scripts/v2/reset-test-billing.ts",
  "scripts/v2/test-billing-reset-db.ts",
  "scripts/v2/reset-v2-staging-customer-data.ts",
  "scripts/v2/test-v2-staging-customer-data-reset-db.ts",
  "scripts/v2/reset-staging-customer-data.ts",
  "scripts/v2/test-reset-staging-customer-data-db.ts",
];

for (const path of resetOnlyScripts) {
  assert(dockerignore.split(/\r?\n/).includes(path), `${path} must be excluded from the Docker build context`);
}

assert.match(dockerfile, /COPY --from=builder \/app\/scripts \.\/scripts/, "non-reset worker/runtime scripts remain in the image");
assert.match(stagingCompose, /command: npm run start/, "staging app keeps the normal Next.js runtime command");
assert.doesNotMatch(stagingCompose, /source:\s*\/var\/www\/soundspa-v2\/scripts|target:\s*\/app\/scripts/, "staging app must not mount the host scripts directory");
assert.match(stagingCompose, /v2-migrate:[\s\S]*?command: npm run db:v2:migrate/, "V2 migration tooling remains configured");

console.info("V2 staging runtime reset exclusion PASS: six reset-only scripts excluded from Docker context; runtime scripts and V2 migration tooling retained; no broad staging scripts mount.");
