import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { operatorAuthStatus, isSameOriginMutation } from "../../lib/v2/adminOperator";

// Explicit staging verification only. Secrets stay in process memory, never logs/files.
async function freePort() {
  const server = createServer(); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve())); return port;
}
let phase = "configuration";
async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to explicitly authorize the isolated staging read-only DB connection.");
  delete process.env.V2_ADMIN_USERNAME; delete process.env.V2_ADMIN_PASSWORD;
  assert.equal(operatorAuthStatus(null), 503);
  const username = "temporary-test-operator"; const password = randomBytes(32).toString("hex");
  process.env.V2_ADMIN_USERNAME = username; process.env.V2_ADMIN_PASSWORD = password;
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  assert.equal(operatorAuthStatus(null), 401); assert.equal(operatorAuthStatus("Basic invalid"), 401); assert.equal(operatorAuthStatus(authorization), 200);
  const sshOptions = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"];
  phase = "staging connection";
  const ip = execFileSync("ssh", [...sshOptions, "Soundspa-Moscow", "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' soundspa-v2-v2-postgres-1"], {encoding:"utf8"}).trim();
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(ip));
  const configuredUrl = execFileSync("ssh", [...sshOptions, "Soundspa-Moscow", "docker exec soundspa-v2-app-1 node -e 'process.stdout.write(process.env.V2_DATABASE_URL)'"], {encoding:"utf8"}).trim();
  const database = new URL(configuredUrl); assert.equal(database.pathname, "/soundspa_v2"); assert.equal(database.username, "soundspa_v2");
  const dbPort = await freePort(); const appPort = await freePort();
  database.hostname = "127.0.0.1"; database.port = String(dbPort);
  const tunnel = spawn("ssh", [...sshOptions, "-o", "ExitOnForwardFailure=yes", "-N", "-L", `127.0.0.1:${dbPort}:${ip}:5432`, "Soundspa-Moscow"], {stdio:["ignore","ignore","pipe"]});
  let tunnelError = ""; tunnel.stderr.on("data", (value) => { tunnelError += value.toString(); });
  let app: ReturnType<typeof spawn> | undefined;
  const uploadRoot=process.argv.includes("--uploads")?await mkdtemp(join(tmpdir(),"soundspa-upload-root-")):undefined;
  try {
    phase = "SSH tunnel readiness";
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(tunnel.exitCode, null, tunnelError);
      ready = await new Promise<boolean>((resolve) => {
        const socket = createConnection({host:"127.0.0.1", port:dbPort});
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", () => resolve(false));
      });
      if (ready) break; await delay(250);
    }
    assert(ready, "SSH tunnel did not open");
    phase = "local HTTP server";
    app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(appPort)], {
      env:{...process.env, DATABASE_URL:"postgresql://dummy:dummy@127.0.0.1:1/dummy", V2_DATABASE_URL:database.toString(), V2_PUBLIC_ORIGIN:"https://test.soundspa.bodhemusic.com",...(uploadRoot?{V2_MEDIA_ROOT:uploadRoot}:{})}, stdio:"ignore",
    });
    const origin = `http://127.0.0.1:${appPort}`;
    const publicOrigin = "https://test.soundspa.bodhemusic.com";
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(`${origin}/app/admin/channels/v2`)).status === 401) break; } catch {}
      assert.equal(app.exitCode, null, "Local test app exited"); await delay(250);
    }
    phase = "unauthorized access";
    assert.equal((await fetch(`${origin}/app/admin/channels/v2`)).status, 401);
    const adminChallenge = await fetch(`${origin}/admin`, { redirect: "manual" });
    assert.equal(adminChallenge.status, 401);
    assert.match(adminChallenge.headers.get("www-authenticate") ?? "", /^Basic\s/i);
    const uiChallenge = await fetch(`${origin}/admin/ui`, { redirect: "manual" });
    assert.equal(uiChallenge.status, 401);
    assert.match(uiChallenge.headers.get("www-authenticate") ?? "", /^Basic\s/i);
    const previewPath = "/admin/ui/locations/15452bf7-c196-41fc-a1a4-9a0ed9e1a044/player-preview";
    const previewChallenge = await fetch(`${origin}${previewPath}`, { redirect: "manual" });
    assert.equal(previewChallenge.status, 401);
    assert.match(previewChallenge.headers.get("www-authenticate") ?? "", /^Basic\s/i);
    assert.equal((await fetch(`${origin}${previewPath}`, { headers: { Cookie: "soundspa_v2_device=not-an-operator" }, redirect: "manual" })).status, 401, "device cookie alone must not authorize operator preview");
    assert.equal((await fetch(`${origin}/admin/ui/locations/00000000-0000-4000-8000-000000000000/player-preview`, { redirect: "manual" })).status, 401, "arbitrary Location ID must still require operator auth");
    phase = "authorized operator preview";
    const preview = await fetch(`${origin}${previewPath}`, { headers: { Authorization: authorization } });
    assert.equal(preview.status, 200);
    const previewHtml = await preview.text();
    assert(previewHtml.includes("Operator Player Preview"));
    assert(previewHtml.includes("Yury Test Spa"));
    assert(previewHtml.includes('data-testid="v2-player"'));
    assert(previewHtml.includes("Divnitsa"));
    phase = "preview/customer catalog equivalence";
    process.env.V2_DATABASE_URL = database.toString();
    const [{ getLocationCustomerCatalog }, { resolveEffectiveChannelAccess }, { filterVisibleChannels, getHiddenChannelIds }, { resolveImageUrl, resolveMediaUrl }, { v2Db, v2Pool }, schema, drizzle] = await Promise.all([
      import("../../lib/v2/customerCatalog"), import("../../db/v2/queries/effectiveAccess"), import("../../db/v2/queries/locationChannelVisibility"), import("../../app/v2/mediaUrls"), import("../../db/v2/client"), import("../../db/v2/schema"), import("drizzle-orm"),
    ]);
    try {
      const locationId = "15452bf7-c196-41fc-a1a4-9a0ed9e1a044";
      const [{ id: fixtureId }] = await v2Db.select({ id: schema.locations.id }).from(schema.locations).where(drizzle.eq(schema.locations.id, locationId)).limit(1);
      assert.equal(fixtureId, locationId, "Yury Test Spa must exist for preview equivalence verification");
      const now = new Date();
      const [actual, access, hidden] = await Promise.all([getLocationCustomerCatalog(locationId, now), resolveEffectiveChannelAccess(locationId, now), getHiddenChannelIds(locationId)]);
      const expected = filterVisibleChannels(access, hidden).map((channel) => ({
        id: channel.id, slug: channel.slug, displayName: channel.displayName, kind: channel.kind, description: channel.description,
        imageUrl: resolveImageUrl(channel.imageKey), playable: channel.playable, suspended: channel.suspended,
        accessSources: channel.accessSources,
        accessExpiries: Object.fromEntries(Object.entries(channel.accessExpiries).map(([key, value]) => [key, value.toISOString()])),
        tracks: channel.playable ? channel.tracks.map((track) => ({ id: track.id, url: resolveMediaUrl(channel.kind, track.storageKey), sizeBytes: track.sizeBytes.toString(), ...(channel.kind === "music" ? { originalFilename: track.originalFilename } : {}) })) : [],
      }));
      assert.deepEqual(actual, expected);
      assert.deepEqual(actual.map(({ id }) => id), expected.map(({ id }) => id));
      for (const hiddenId of hidden) assert(!actual.some(({ id }) => id === hiddenId), "hidden channel must be omitted");
      for (const channel of actual.filter(({ playable }) => !playable)) assert.deepEqual(channel.tracks, [], "locked channel must expose no media URLs");
      assert(actual.some(({ slug, playable, accessSources }) => slug === "divnitsa" && playable && accessSources.includes("admin")), "existing Divnitsa admin grant should remain playable in Yury Test Spa preview");
      const serialized = JSON.stringify(actual);
      for (const forbidden of ["storageKey", "underlyingSources", "credentialHash"]) assert(!serialized.includes(forbidden));
    } finally { await v2Pool.end(); }
    assert.equal((await fetch(`${origin}/admin/ui/locations/not-a-uuid/player-preview`, { headers: { Authorization: authorization }, redirect: "manual" })).status, 404);
    assert.equal((await fetch(`${origin}/admin/ui/locations/00000000-0000-4000-8000-000000000000/player-preview`, { headers: { Authorization: authorization }, redirect: "manual" })).status, 404);
    assert.equal((await fetch(`${origin}/api/v2/admin/content`, {method:"POST", headers:{Origin:origin}})).status, 401);
    assert.equal((await fetch(`${origin}/api/v2/catalog`)).status, 401, "normal customer catalog still requires device auth");
    assert.equal((await fetch(`${origin}/api/v2/catalog`, { headers: { Cookie: "soundspa_v2_device=invalid" } })).status, 401);
    assert.equal((await fetch(`${origin}/player`)).status, 200, "normal player route remains unchanged and continues resolving through the existing device-authenticated catalog request");
    phase = "authorized six-channel Admin page";
    const adminRedirect = await fetch(`${origin}/admin`, { headers: { Authorization: authorization }, redirect: "manual" });
    assert.equal(adminRedirect.status, 307);
    assert.equal(adminRedirect.headers.get("location"), "/admin/ui");
    const adminUi = await fetch(`${origin}/admin/ui`, { headers: { Authorization: authorization } });
    assert.equal(adminUi.status, 200);
    const response = await fetch(`${origin}/app/admin/channels/v2`, {headers:{Authorization:authorization}});
    assert.equal(response.status, 200); const html = await response.text();
    const expectedCounts={channels:Number(process.env.V2_TEST_CHANNELS??6),tracks:Number(process.env.V2_TEST_TRACKS??8)};
    const normalized=html.replace(/<!--.*?-->/g, "");
    assert(normalized.includes(`All V2 channels (${expectedCounts.channels})`),`Expected ${expectedCounts.channels} Admin channels; observed ${normalized.match(/All V2 channels[^<]{0,40}/)?.[0]??"missing catalog heading"}`);
    for (const title of ["Divnitsa","Relax","432 Hz","Forest","Night","Sea"]) assert(html.includes(title));
    phase = "cross-origin mutation";
    assert.equal((await fetch(`${origin}/api/v2/admin/content`, {method:"POST", headers:{Authorization:authorization, Origin:"https://untrusted.invalid"}})).status, 403);
    assert(!isSameOriginMutation(new Request(`${origin}/api/v2/admin/content`, {method:"POST"})));
    // Unknown operation is rejected within a transaction; never changes seeded data.
    phase = "authorized validation feedback";
    const rejected = await fetch(`${origin}/api/v2/admin/content`, {method:"POST", redirect:"manual", headers:{Authorization:authorization, Origin:publicOrigin, "Content-Type":"application/x-www-form-urlencoded"}, body:"operation=unknown"});
    assert.equal(rejected.status, 303); assert(rejected.headers.get("location")?.includes("Unknown+operation"));
    phase = "public DB catalog";
    const publicPage = await fetch(`${origin}/v2`); assert.equal(publicPage.status, 200);
    const publicHtml = await publicPage.text(); assert(publicHtml.includes('data-catalog-source="v2-db"'));
    for (const title of ["Divnitsa","Relax","432 Hz","Forest","Night","Sea"]) assert(publicHtml.includes(title));
    phase = "existing staging regressions";
    const testEnv = { ...process.env, DATABASE_URL: "postgresql://dummy:dummy@127.0.0.1:1/dummy", V2_DATABASE_URL: database.toString(), V2_VERIFY_ORIGIN: origin, V2_PUBLIC_ORIGIN: publicOrigin };
    for (const script of ["test-customer-provisioning", "test-device-activation", "verify-effective-access", "verify-base", "verify-admin-grants", "verify-location-channel-visibility"]) {
      execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", `scripts/v2/${script}.ts`, "--staging"], { env: testEnv, stdio: "inherit" });
    }
    if(uploadRoot){
      phase="synthetic upload verification";
      process.env.V2_DATABASE_URL=database.toString();process.env.V2_MEDIA_ROOT=uploadRoot;
      const {verifyContentUploads}=await import("./verify-content-uploads");
      await verifyContentUploads(origin,authorization,undefined,expectedCounts);
    }
    console.info("PASS: missing config fail-closed; Basic challenge for Admin and Location preview; device-cookie-only and arbitrary-ID preview rejected; authorized Yury Test Spa preview rendered by shared Player; malformed/unknown Location return 404; Admin mutation protections and public DB catalog regression. Local test app/tunnel only; staging runtime unchanged.");
  } finally {
    app?.kill(); tunnel.kill();
    if(uploadRoot)await rm(uploadRoot,{recursive:true,force:true});
  }
}
main().catch((e) => { console.error(`Content Admin HTTP verification failed at ${phase}; ${e instanceof Error&&e.name==="AssertionError"?e.message.slice(0,250):"no internal details emitted"}`); process.exitCode = 1; });
