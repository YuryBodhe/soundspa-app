import { db } from "@/lib/db.pg";
import { monitoringLogs, monitoringReports } from "@/db/schema/monitoring";
import { eq, gte, desc, and } from "drizzle-orm";

export async function saveMonitoringReport(params: {
  tenantId?: number | null;
  agentName: string;
  type: string;
  content: string;
  status?: string;
}) {
  const { tenantId = null, agentName, type, content, status = "ok" } = params;

  await db.insert(monitoringReports).values({
    tenantId,
    agentName,
    type,
    content,
    status,
  });
}

export async function getLastReportTime(type: string, tenantId?: number | null) {
  const filters = tenantId == null
    ? eq(monitoringReports.type, type)
    : and(
        eq(monitoringReports.type, type),
        eq(monitoringReports.tenantId, tenantId),
      );

  const query = db
    .select()
    .from(monitoringReports)
    .where(filters)
    .orderBy(desc(monitoringReports.createdAt))
    .limit(1);

  const [last] = await query;
  return last?.createdAt ?? null;
}

export async function getLogsSince(options: {
  tenantId?: number;
  hoursBack: number;
  limit?: number;
}) {
  const { tenantId, hoursBack, limit = 500 } = options;
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  const where = tenantId != null
    ? and(
        eq(monitoringLogs.tenantId, tenantId),
        gte(monitoringLogs.createdAt, since),
      )
    : gte(monitoringLogs.createdAt, since);

  return db
    .select()
    .from(monitoringLogs)
    .where(where)
    .orderBy(desc(monitoringLogs.createdAt))
    .limit(limit);
}