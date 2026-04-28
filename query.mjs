import { db } from './lib/db.pg.js';
import { agents, monitoringLogs, tenants } from './db/schema.js';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const agentRows = await db.select().from(agents);
  console.log('Agents:', JSON.stringify(agentRows, null, 2));
  const tenantRows = await db.select().from(tenants);
  console.log('Tenants:', JSON.stringify(tenantRows, null, 2));
  const monitorRows = await db.select().from(monitoringLogs).orderBy(desc(monitoringLogs.createdAt)).limit(20);
  console.log('Recent monitoring logs:', JSON.stringify(monitorRows, null, 2));
}
main().catch(console.error);
