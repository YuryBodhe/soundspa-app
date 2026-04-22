import { db } from "@/lib/db.pg";
import { agents } from "@/db/schema/agents";
import { eq } from "drizzle-orm";
import { sendTelegramMessage } from "@/lib/notifications/telegram";

export async function runAgent(agentName: string, context: string) {
  // 1. Ищем агента в базе по имени
  const agent = await db.query.agents.findFirst({
    where: eq(agents.name, agentName),
  });

  if (!agent) {
    const errorMsg = `Агент с именем "${agentName}" не найден в базе.`;
    await sendTelegramMessage(`❌ **Ошибка системы:** ${errorMsg}`);
    throw new Error(errorMsg);
  }

  if (!agent.isActive) {
    throw new Error(`Агент "${agentName}" сейчас выключен.`);
  }

  // 2. Отправляем запрос в OpenRouter
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://soundspa.ai",
        "X-Title": "SoundSpa AI Factory",
      },
      body: JSON.stringify({
        model: agent.model || "nvidia/llama-3.1-nemotron-70b-instruct",
        messages: [
          { role: "system", content: agent.systemPrompt },
          { role: "user", content: context },
        ],
        temperature: agent.temperature ?? 0.7,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Ошибка OpenRouter: ${data.error.message}`);
    }

    const result = data.choices[0].message.content;

    // 🔥 Если это наш Watcher, отправляем его отчет в Телеграм
    if (agentName === "watcher") {
      await sendTelegramMessage(`🤖 **Отчет Watcher:**\n\n${result}`);
    }

    return result;
  } catch (error: any) {
    console.error("Ошибка при работе агента:", error);
    
    // Уведомляем в ТГ о критическом сбое
    await sendTelegramMessage(`⚠️ **Сбой агента ${agentName}:**\n${error.message}`);
    
    throw error;
  }
}