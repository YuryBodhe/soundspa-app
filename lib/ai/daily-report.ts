import "dotenv/config";
import { db } from "../../db";
import { monitoringLogs } from "@/db/schema/monitoring";
import { agents } from "@/db/schema/agents";
import { runAgent } from "./agent-runner";
import { sendTelegramMessage } from "../notifications/telegram";
import { eq, and, gte, desc } from "drizzle-orm";

async function generateSmartReport(tenantId: number) {
  console.log(`📊 Запуск автономного аналитика для салона ID: ${tenantId}...`);

  // 1. Идем в базу за твоими инструкциями (управление через Drizzle Studio)
  const agentConfig = await db
    .select()
    .from(agents)
    .where(and(
      eq(agents.name, "watcher"),
      eq(agents.isActive, true) // Если в базе isActive: false, отчет не пойдет
    ))
    .limit(1);

  if (agentConfig.length === 0) {
    console.log("ℹ️ Агент 'watcher' не найден или деактивирован в базе (isActive: false).");
    return;
  }

  const { systemPrompt } = agentConfig[0];

  // 2. Собираем технические данные за последние 24 часа
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logs = await db
    .select()
    .from(monitoringLogs)
    .where(
      and(
        eq(monitoringLogs.tenantId, tenantId),
        gte(monitoringLogs.createdAt, dayAgo)
      )
    )
    .orderBy(desc(monitoringLogs.createdAt))
    .limit(300); // Увеличили лимит, чтобы ИИ видел больше данных

  if (logs.length === 0) {
    console.log("📭 Логов за сутки не найдено. Пропускаю.");
    return;
  }

  const context = logs.map(l => 
    `[${l.createdAt?.toISOString()}] ${l.event}: ${l.details}`
  ).join("\n");

  // 3. Запрос к ИИ с динамическим промптом
  const report = await runAgent("watcher", `
    ИНСТРУКЦИЯ ИЗ БАЗЫ (Drizzle Studio):
    ${systemPrompt}

    ДАННЫЕ ЛОГОВ:
    ${context}
  `);

  // 4. Фильтр тишины
  if (report.includes("SKIP") || report.trim().length < 5) {
    console.log("🤫 ИИ проанализировал логи и решил не беспокоить согласно промпту.");
    return;
  }

  // 5. Отправка
  await sendTelegramMessage(`📈 *Отчет Soundspa (AI Agent)*\n\n${report}`);
  console.log("✅ Отчет отправлен!");
}

// Запуск для основного салона
generateSmartReport(1);