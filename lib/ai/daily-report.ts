import "dotenv/config";
import { db } from "@/lib/db.pg";
import { monitoringLogs } from "@/db/schema/monitoring";
import { runAgent } from "./agent-runner";
import { sendTelegramMessage } from "../notifications/telegram";
import { eq, and, gte, desc } from "drizzle-orm";

async function generateSmartReport(tenantId: number) {
  console.log(`📊 Собираю данные для салона ID: ${tenantId}...`);

  // 1. Берем логи за последние 24 часа
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
    .limit(50); // Берем последние 50 записей для контекста

  if (logs.length === 0) {
    console.log("📭 Логов за сутки не найдено.");
    return;
  }

  // 2. Формируем контекст для ИИ
  const context = logs.map(l => 
    `[${l.createdAt?.toISOString()}] ${l.event} (${l.level}): ${l.details}`
  ).join("\n");

  // 3. Вызываем агента (используем того же watcher или создай нового 'analyst')
  const prompt = `
    ПРОАНАЛИЗИРУЙ ЛОГИ САЛОНА ЗА 24 ЧАСА:
    ${context}
    
    Твоя задача — составить краткий технический отчет для владельца.
    Укажи:
    1. Стабильность (были ли разрывы).
    2. Какие каналы/устройства светились в метаданных.
    3. Общий вердикт.
  `;

  const report = await runAgent("watcher", prompt);

  // 4. Шлем результат в Telegram
  await sendTelegramMessage(`📈 *Суточный отчет: soundspa-main*\n\n${report}`);
  console.log("✅ Отчет отправлен в Telegram!");
}

// Запускаем для твоего основного салона (замени ID на реальный из базы)
generateSmartReport(1);