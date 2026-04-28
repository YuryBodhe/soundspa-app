import "dotenv/config";
import { runAgent } from "./agent-runner";
import { getLogsSince, saveMonitoringReport, getLastReportTime } from "@/lib/monitoring/reporting";

export async function generateTenantReport(tenantId: number, options?: {
  hoursBack?: number;
  reportType?: string;
  agentName?: string;
}) {
  const {
    hoursBack = 6,
    reportType = "tenant_signal",
    agentName = "watcher",
  } = options ?? {};

  console.log(`📊 Аналитика для салона ID ${tenantId} (последние ${hoursBack}ч)...`);

  const logs = await getLogsSince({ tenantId, hoursBack, limit: 500 });
  if (logs.length === 0) {
    console.log("📭 Нет логов для анализа. Пропуск.");
    return;
  }

  const lastReportTime = await getLastReportTime(reportType, tenantId);

  const context = `
  Параметры:
  - tenantId: ${tenantId}
  - период: последние ${hoursBack} часов
  - последний отчет: ${lastReportTime?.toISOString() ?? "нет"}

  Логи:
  ${logs.map((l) => `[${l.createdAt?.toISOString()}] ${l.event}: ${l.details}`).join("\n")}
  `;

  const report = await runAgent(agentName, context);

  if (report.trim().toUpperCase() === "SKIP" || report.trim().length < 5) {
    console.log("🤫 Агент пропустил отчет.");
    return;
  }

  await saveMonitoringReport({
    tenantId,
    agentName,
    type: reportType,
    content: report,
    status: "ok",
  });

  console.log("✅ Отчет сохранен в monitoring_reports.");
}