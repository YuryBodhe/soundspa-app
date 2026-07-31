import cron from "node-cron";
import { runCleanup } from "./monitoring/cleanup-logs";
import { generateTenantReport } from "@/lib/ai/daily-report";
import { runDailyZavodReport } from "@/lib/ai/daily-summary";
import { markTenantsOffline } from "@/lib/monitoring/current";
import { db } from "@/lib/db.pg";
import { tenants } from "@/db/schema.pg";

// Импорты для новой системы отсрочки уведомлений о логинах
import { monitoringLogs, telegramQueue } from "@/db/schema/monitoring";
import { and, gt, eq, asc, lt, inArray } from "drizzle-orm";
import { sendTelegramMessage } from "@/lib/notifications/telegram";

// -----------------------------------------------------------------------------
// Утилиты для ограничения нагрузки
// -----------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWithConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  pauseMs = 0,
) {
  const queue = [...items];
  let index = 0;

  async function runWorker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const currentIndex = index++;
      try {
        await worker(item, currentIndex);
      } catch (err) {
        console.error("❌ Ошибка при обработке элемента очереди", err);
      }
      if (pauseMs > 0) {
        await sleep(pauseMs);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);
}

function splitTenantsIntoSlots<T extends { id: number }>(allTenants: T[], slots: number): T[] {
  if (slots <= 1) return allTenants;
  const slotIndex = Math.floor(Date.now() / (30 * 60 * 1000)) % slots;
  return allTenants.filter((tenant) => tenant.id % slots === slotIndex);
}

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

// Периодическая аналитика: каждые 30 минут (с ограничением нагрузки)
cron.schedule("*/30 * * * *", async () => {
  console.log("⏱️ Watcher: запуск цикла каждые 30 минут (ограниченный режим)...");
  try {
    const allTenants = await db.select().from(tenants);
    if (allTenants.length === 0) {
      console.log("⏱️ Нет арендаторов для отчёта");
      return;
    }

    const tenantsForThisRun = splitTenantsIntoSlots(allTenants, 4);
    if (tenantsForThisRun.length === 0) {
      console.log("⏱️ В текущем слоте нет арендаторов для обработки");
      return;
    }

    console.log(
      `⏱️ Всего tenants: ${allTenants.length}, в этом слоте: ${tenantsForThisRun.length}`,
    );

    await runWithConcurrencyLimit(
      tenantsForThisRun,
      3,
      async (tenant) => {
        await generateTenantReport(tenant.id, {
          hoursBack: 6,
          reportType: "tenant_signal",
        });
      },
      250,
    );

    console.log("⏱️ Watcher: слот обработан без перегрузки");
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

const MAX_LOGINS_PER_MESSAGE = 20;
const TELEGRAM_BATCH_SIZE = 5;
const TELEGRAM_MAX_ATTEMPTS = 5;

// 🔥 ОТЛОЖЕННЫЕ УВЕДОМЛЕНИЯ: Проверяем логины каждые 5 минут
cron.schedule("*/5 * * * *", async () => {
  console.log("🔑 Воркер: сбор логов авторизации за последние 5 минут...");
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Вытягиваем логины из нашей таблицы мониторинга
    const freshLogins = await db
      .select()
      .from(monitoringLogs)
      .where(
        and(
          inArray(monitoringLogs.eventType, ["auth_event", "auth_login"]),
          gt(monitoringLogs.createdAt, fiveMinutesAgo),
        ),
      );

    if (freshLogins.length === 0) {
      console.log("🔑 Новых логинов за 5 минут нет.");
      return;
    }

    const chunks: typeof freshLogins[] = [];
    for (let i = 0; i < freshLogins.length; i += MAX_LOGINS_PER_MESSAGE) {
      chunks.push(freshLogins.slice(i, i + MAX_LOGINS_PER_MESSAGE));
    }

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      let message = `🔑 *Сводный отчет по авторизациям* — пачка ${
        chunkIndex + 1
      }/${chunks.length}:\n\n`;

      chunk.forEach((log, index) => {
        const logTime = log.createdAt
          ? new Date(log.createdAt).toLocaleTimeString("ru-RU", {
              timeZone: "Asia/Ho_Chi_Minh",
            })
          : "";

        // Пытаемся достать данные из JSONB колонки details
        const details = typeof log.details === 'object' ? log.details : {};
        // Используем приведение к any, так как структура details динамическая
        const email = (details as any)?.email || 'Без email';
        const userId = (details as any)?.user_id || 'ID?';

        message += `${index + 1}. 🟢 *${email}* (ID: ${userId}) \`[${logTime}]\`\n`;
      });

      await db.insert(telegramQueue).values({
        payload: JSON.stringify({ type: "logins_summary", text: message }),
      });
    }

    console.log(
      `📬 В очередь Telegram добавлено ${chunks.length} сообщений (${freshLogins.length} логинов).`,
    );

  } catch (err) {
    console.error("❌ Ошибка воркера при обработке логов авторизации:", err);
  }
});

// Обработчик очереди Telegram: каждые 10 секунд пробуем отправить до 5 сообщений
cron.schedule("*/10 * * * * *", async () => {
  try {
    const pending = await db
      .select()
      .from(telegramQueue)
      .where(
        and(
          eq(telegramQueue.status, "pending"),
          lt(telegramQueue.attempts, TELEGRAM_MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(telegramQueue.createdAt))
      .limit(TELEGRAM_BATCH_SIZE);

    if (pending.length === 0) return;

    for (const item of pending) {
      let text = "";
      try {
        const payload = JSON.parse(item.payload ?? "{}") as { text?: string };
        text = payload.text ?? "";
      } catch (error) {
        console.error("❌ Невалидный payload в telegram_queue", item.id, error);
        await db
          .update(telegramQueue)
          .set({ status: "error", attempts: item.attempts + 1, lastError: "Invalid payload" })
          .where(eq(telegramQueue.id, item.id));
        continue;
      }

      if (!text) {
        await db
          .update(telegramQueue)
          .set({ status: "error", attempts: item.attempts + 1, lastError: "Empty text" })
          .where(eq(telegramQueue.id, item.id));
        continue;
      }

      try {
        await sendTelegramMessage(text);
        await db
          .update(telegramQueue)
          .set({ status: "sent", attempts: item.attempts + 1, lastError: null })
          .where(eq(telegramQueue.id, item.id));
        await sleep(500);
      } catch (error: any) {
        const attempts = item.attempts + 1;
        const isFinal = attempts >= TELEGRAM_MAX_ATTEMPTS;
        await db
          .update(telegramQueue)
          .set({
            status: isFinal ? "error" : "pending",
            attempts,
            lastError: String(error?.message ?? error),
          })
          .where(eq(telegramQueue.id, item.id));
      }
    }
  } catch (err) {
    console.error("❌ Ошибка обработчика очереди Telegram:", err);
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