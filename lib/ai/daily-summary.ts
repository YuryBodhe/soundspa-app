import { db } from "@/lib/db.pg";
import { monitoringLogs } from "@/db/schema/monitoring";
import { tenants } from "@/db/schema.pg";
import { runAgent } from "./agent-runner";
import { getLastReportTime, saveMonitoringReport } from "@/lib/monitoring/reporting";
import { and, gte, eq } from "drizzle-orm";

export async function runDailyZavodReport(options?: {
  reportType?: string;
  agentName?: string;
}) {
  const {
    reportType = "zavod_daily_summary",
    agentName = "watcher",
  } = options ?? {};

  const allTenants = await db.select().from(tenants);
  const reportDate = new Date().toLocaleDateString("ru-RU");
  const lastReportTime = await getLastReportTime(reportType, null);

  let globalContext = `ОТЧЕТ ПО ЗАВОДУ ЗА ${reportDate}\nПоследний отчет: ${lastReportTime?.toISOString() ?? "нет"}\n\n`;

  for (const tenant of allTenants) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const logs = await db.select().from(monitoringLogs).where(
      and(
        eq(monitoringLogs.tenantId, tenant.id),
        gte(monitoringLogs.createdAt, today),
      ),
    );

    if (logs.length > 0) {
      globalContext += `САЛОН: ${tenant.name} (ID: ${tenant.id})\n`;
      globalContext += logs
        .map((l) => `- [${l.createdAt?.toLocaleTimeString()}] ${l.details}`)
        .join("\n");
      globalContext += `\n---\n`;
    }
  }

  const finalPrompt = `Ты — бизнес-аналитик. Если новых данных нет или с прошлого отчета прошло мало времени, ответь SKIP.`;
  const aiSummary = await runAgent(agentName, `${finalPrompt}\n\nДАННЫЕ:\n${globalContext}`);

  if (aiSummary.trim().toUpperCase() === "SKIP" || aiSummary.trim().length < 5) {
    console.log("🤫 Агент пропустил заводскую сводку.");
    return;
  }

  await saveMonitoringReport({
    tenantId: null,
    agentName,
    type: reportType,
    content: aiSummary,
  });

  console.log("✅ Заводская сводка сохранена в monitoring_reports.");
}