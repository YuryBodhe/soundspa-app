// Explicitly invoked staging-only sentinel. Never runs during build/start/migrate.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { organizations } from "../../db/v2/schema";
import { getOrganization } from "../../db/v2/queries/core";

async function main() {
  let sentinelId: string | undefined;
  try {
    const target = await v2Db.execute(sql`select current_database() as database, current_user as "user",
      inet_server_addr()::text as address, inet_server_port() as port`);
    if (target.rows[0]?.database !== "soundspa_v2") throw new Error("Unexpected V2 DB target.");
    console.info("V2 target:", target.rows[0]);
    const tables = await v2Db.execute(sql`select table_name from information_schema.tables
      where table_schema = 'public' and table_name in
      ('organizations', 'users', 'organization_members', 'locations') order by table_name`);
    if (tables.rows.length !== 4) throw new Error("V2 Core tables are missing.");
    const [sentinel] = await v2Db.insert(organizations)
      .values({ name: `core-verification-${randomUUID()}` }).returning({ id: organizations.id });
    sentinelId = sentinel.id;
    if (!(await getOrganization(sentinelId))) throw new Error("Sentinel read failed.");
    console.info("V2 Core sentinel PASS.");
  } finally {
    try {
      if (sentinelId) await v2Db.delete(organizations).where(eq(organizations.id, sentinelId));
    } finally {
      await v2Pool.end();
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
