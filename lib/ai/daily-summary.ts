import { db } from "@/lib/db.pg";
import { monitoringLogs, monitoringCurrent } from "@/db/schema/monitoring";
import { tenants } from "@/db/schema.pg";
import { runAgent } from "./agent-runner";
import { sendTelegramMessage } from "../notifications/telegram";
import { and, gte, eq } from "drizzle-orm";

async function runDailyZavodReport() {
  // 1. Получаем список всех активных салонов
  const allTenants = await db.select().from(tenants);
  const reportDate = new Date().toLocaleDateString('ru-RU');
  
  let globalContext = `ОТЧЕТ ПО ЗАВОДУ ЗА ${reportDate}\n\n`;

  for (const tenant of allTenants) {
    // Собираем логи за сегодня (с 00:00)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const logs = await db.select().from(monitoringLogs).where(
      and(
        eq(monitoringLogs.tenantId, tenant.id),
        gte(monitoringLogs.createdAt, today)
      )
    );

    if (logs.length > 0) {
      globalContext += `САЛОН: ${tenant.name} (ID: ${tenant.id})\n`;
      globalContext += logs.map(l => `- [${l.createdAt?.toLocaleTimeString()}] ${l.details}`).join("\n");
      globalContext += `\n---\n`;
    }
  }

  // 2. Просим ИИ сделать "человеческую" выжимку
  const finalPrompt = `
    Ты — бизнес-аналитик ИИ-Завода. Составь краткий и четкий отчет на основе логов:
    - Какие салоны работали (включались).
    - Какие каналы играли в каждом и сколько примерно времени.
    - На каких устройствах шел эфир.
    Пиши кратко, в стиле Юрия (бизнес, эффективность, без воды).
  `;

  const aiSummary = await runAgent("watcher", `${finalPrompt}\n\nДАННЫЕ:\n${globalContext}`);

  // 3. Отправка в Telegram
  await sendTelegramMessage(`🌆 *Вечерняя сводка (Далат 21:00)*\n\n${aiSummary}`);
}