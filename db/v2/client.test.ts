import assert from "node:assert/strict";
import test from "node:test";

test("V2 database URL is required on first database use, not module import", async () => {
  const originalUrl = process.env.V2_DATABASE_URL;
  delete process.env.V2_DATABASE_URL;
  try {
    const client = await import("./client");
    assert.ok(client.v2Db);
    assert.throws(() => client.v2Db.select(), /V2_DATABASE_URL is required/);

    process.env.V2_DATABASE_URL = "postgres://local:local@127.0.0.1:5432/soundspa_v2";
    assert.doesNotThrow(() => client.v2Db.select());
    await client.v2Pool.end();
  } finally {
    if (originalUrl === undefined) delete process.env.V2_DATABASE_URL;
    else process.env.V2_DATABASE_URL = originalUrl;
  }
});
