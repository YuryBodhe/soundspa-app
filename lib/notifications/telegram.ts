export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("Telegram credentials missing in .env", {
      hasToken: Boolean(token),
      hasChatId: Boolean(chatId),
    });
    return;
  }

  // Добавляем контроллер таймаута (4 секунды)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown", // Позволяет делать текст жирным или курсивом
      }),
      signal: controller.signal, // Привязываем таймаут к запросу
    });
    
      clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text();
      console.error("Telegram API error", {
        status: response.status,
        body,
      });
    }
  } catch (error: any) {
    clearTimeout(timeoutId); // Очищаем таймаут в случае ошибки
    if (error.name === 'AbortError') {
      console.error("Failed to send Telegram message: Request timed out (4s)");
    } else {
      console.error("Failed to send Telegram message:", error);
    }
  }
}