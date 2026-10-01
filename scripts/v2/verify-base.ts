import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { baseChannels, channels, locationChannelEntitlements } from "../../db/v2/schema";
import { getBaseChannelIds, getBaseChannels } from "../../db/v2/queries/base";

class VerificationRollback extends Error {}
async function main() {
  try {
    const table = await v2Db.execute(sql`SELECT to_regclass('public.base_channels') AS table_name`);
    assert.equal(table.rows[0]?.table_name, "base_channels");
    const ids = await getBaseChannelIds();
    const base = await getBaseChannels();
    assert.deepEqual(base.map(({ channel }) => channel.id).sort(), [...ids].sort(), "Base query must reflect the current operator-managed set");
    const beforeEntitlements = await v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelEntitlements);
    const [candidate] = await v2Db.select({ id: channels.id }).from(channels).limit(1);
    assert(candidate, "At least one Channel must exist for Base constraint verification");
    await v2Db.transaction(async (tx) => {
      const duplicateTarget = ids[0] ?? candidate.id;
      if (!ids.includes(duplicateTarget)) await tx.insert(baseChannels).values({ channelId: duplicateTarget });
      await assert.rejects(tx.insert(baseChannels).values({ channelId: duplicateTarget }));
      await assert.rejects(tx.insert(baseChannels).values({ channelId: randomUUID() }));
      throw new VerificationRollback();
    }).catch((error) => { if (!(error instanceof VerificationRollback)) throw error; });
    const afterEntitlements = await v2Db.select({ count: sql<number>`count(*)::int` }).from(locationChannelEntitlements);
    assert.equal(afterEntitlements[0]?.count, beforeEntitlements[0]?.count);
    const finalIds = await getBaseChannelIds();
    assert.deepEqual(finalIds, ids);
    console.info("V2 Base verification PASS: table and constraints checked against the live operator-managed membership set; exact membership and entitlement count restored.");
  } finally { await v2Pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
