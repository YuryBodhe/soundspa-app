import "dotenv/config";
import { runAgent } from "./lib/ai/agent-runner";
import { sendTelegramMessage } from "./lib/notifications/telegram";

async function test() {
  console.log("🚀 Запуск проверки Watcher с уведомлением...");

  const mockData = `
    ОТЧЕТ МОНИТОРИНГА:
    - Салон: "Орхидея Далат"
    - Статус: Offline
    - Причина: Ошибка диска
  `;

  try {
    const result = await runAgent("watcher", mockData);
    
    // Если в ответе агента есть слово ALARM — шлем в Телегу
    if (result.includes("ALARM")) {
      await sendTelegramMessage(`🚨 *Внимание! Обнаружена проблема:* \n\n${result}`);
      console.log("📨 Уведомление отправлено в Telegram!");
    }

    console.log("🤖 Ответ агента:", result);
  } catch (error) {
    console.error("❌ Ошибка:", error);
  }
}

test();