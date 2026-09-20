import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { baseChannels, channels, locationChannelEntitlements } from "../../db/v2/schema";
import { getBaseChannelIds, getBaseChannels } from "../../db/v2/queries/base";

class VerificationRollback extends Error {}
async function main() {
  try {
    const table = await v2Db.execute(sql`SELECT to_regclass('public.base_channels') AS table_name`);
    assert.equal(table.rows[0]?.table_name, "base_channels");
    const [spaquatoria] = await v2Db.select({ id: channels.id, slug: channels.slug }).from(channels).where(eq(channels.slug, "spaquatoria"));
    assert(spaquatoria, "Spaquatoria channel must exist");
    const ids = await getBaseChannelIds();
    assert(ids.includes(spaquatoria.id), "Spaquatoria must be in Base");
    const base = await getBaseChannels();
    assert(base.some(({ channel }) => channel.id === spaquatoria.id));
    const beforeEntitlements = await v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelEntitlements);
    await v2Db.transaction(async (tx) => {
      const [ambient] = await tx.select({ id: channels.id }).from(channels).where(eq(channels.kind, "ambient")).limit(1);
      assert(ambient, "An ambient channel must exist for structural verification");
      await tx.insert(baseChannels).values({ channelId: ambient.id });
      await assert.rejects(tx.insert(baseChannels).values({ channelId: ambient.id }));
      await assert.rejects(tx.insert(baseChannels).values({ channelId: randomUUID() }));
      throw new VerificationRollback();
    }).catch((error) => { if (!(error instanceof VerificationRollback)) throw error; });
    const afterEntitlements = await v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelEntitlements);
    assert.equal(afterEntitlements[0]?.count, beforeEntitlements[0]?.count);
    const finalIds = await getBaseChannelIds();
    assert.deepEqual(finalIds, ids);
    console.info("V2 Base verification PASS: table, seeded Spaquatoria, music/ambient FK+PK rollback checks, entitlement count unchanged.");
  } finally { await v2Pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
