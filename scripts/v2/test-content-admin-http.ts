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
      env:{...process.env, DATABASE_URL:"postgresql://dummy:dummy@127.0.0.1:1/dummy", V2_DATABASE_URL:database.toString(),...(uploadRoot?{V2_MEDIA_ROOT:uploadRoot}:{})}, stdio:"ignore",
    });
    const origin = `http://127.0.0.1:${appPort}`;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(`${origin}/app/admin/channels/v2`)).status === 401) break; } catch {}
      assert.equal(app.exitCode, null, "Local test app exited"); await delay(250);
    }
    phase = "unauthorized access";
    assert.equal((await fetch(`${origin}/app/admin/channels/v2`)).status, 401);
    assert.equal((await fetch(`${origin}/api/v2/admin/content`, {method:"POST", headers:{Origin:origin}})).status, 401);
    phase = "authorized six-channel Admin page";
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
    const rejected = await fetch(`${origin}/api/v2/admin/content`, {method:"POST", redirect:"manual", headers:{Authorization:authorization, Origin:origin, "Content-Type":"application/x-www-form-urlencoded"}, body:"operation=unknown"});
    assert.equal(rejected.status, 303); assert(rejected.headers.get("location")?.includes("Unknown+operation"));
    phase = "public DB catalog";
    const publicPage = await fetch(`${origin}/v2`); assert.equal(publicPage.status, 200);
    const publicHtml = await publicPage.text(); assert(publicHtml.includes('data-catalog-source="v2-db"'));
    for (const title of ["Divnitsa","Relax","432 Hz","Forest","Night","Sea"]) assert(publicHtml.includes(title));
    if(uploadRoot){
      phase="synthetic upload verification";
      process.env.V2_DATABASE_URL=database.toString();process.env.V2_MEDIA_ROOT=uploadRoot;
      const {verifyContentUploads}=await import("./verify-content-uploads");
      await verifyContentUploads(origin,authorization,undefined,expectedCounts);
    }
    console.info("PASS: missing config fail-closed, Basic auth, unauthorized page/mutation 401, authorized six-channel Admin 200, cross-origin mutation 403, explicit validation feedback, public six-card DB catalog 200. Local test app/tunnel only; staging runtime unchanged.");
  } finally {
    app?.kill(); tunnel.kill();
    if(uploadRoot)await rm(uploadRoot,{recursive:true,force:true});
  }
}
main().catch((e) => { console.error(`Content Admin HTTP verification failed at ${phase}; ${e instanceof Error&&e.name==="AssertionError"?e.message.slice(0,250):"no internal details emitted"}`); process.exitCode = 1; });
