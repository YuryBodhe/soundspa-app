import cron from "node-cron";
import { runCleanup } from "./monitoring/cleanup-logs";
import { generateTenantReport } from "@/lib/ai/daily-report";
import { runDailyZavodReport } from "@/lib/ai/daily-summary";
import { markTenantsOffline } from "@/lib/monitoring/current";
import { db } from "@/lib/db.pg";
import { tenants } from "@/db/schema.pg";

console.log("🚀 ИИ-Завод: Фоновый помощник запущен...");

// Очистка логов: каждый день в 03:00
cron.schedule("0 3 * * *", async () => {
  console.log("🧹 Запуск плановой очистки логов...");
  try {
    const result = await runCleanup(14); // Храним 14 дней
    console.log(`✅ Результат: ${result.message}`);
  } catch (err) {
    console.error("❌ Ошибка при очистке логов:", err);
  }
});

// Периодическая аналитика: каждые 30 минут
cron.schedule("*/30 * * * *", async () => {
  console.log("⏱️ Watcher: запуск цикла каждые 30 минут...");
  try {
    const allTenants = await db.select().from(tenants);
    for (const tenant of allTenants) {
      await generateTenantReport(tenant.id, {
        hoursBack: 6,
        reportType: "tenant_signal",
      });
    }
  } catch (err) {
    console.error("❌ Ошибка в watcher-цикле:", err);
  }
});

// Проверяем молчащие салоны: каждые 5 минут
cron.schedule("*/5 * * * *", async () => {
  console.log("🛰️ Проверка heartbeat -> offline...");
  try {
    await markTenantsOffline(5); // offline, если нет событий >5 минут
  } catch (err) {
    console.error("❌ Ошибка при отметке offline:", err);
  }
});

// Общая заводская сводка: каждый день в 20:00
cron.schedule("0 20 * * *", async () => {
  console.log("🏙️ Запуск заводской сводки...");
  try {
    await runDailyZavodReport();
  } catch (err) {
    console.error("❌ Ошибка при формировании заводской сводки:", err);
  }
});

process.stdin.resume(); // Не даем процессу завершиться