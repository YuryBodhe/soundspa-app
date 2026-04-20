import { db } from "@/lib/db.pg";
import { agents } from "@/db/schema/agents";
import { eq } from "drizzle-orm";

export async function runAgent(agentName: string, context: string) {
  // 1. Ищем агента в базе по имени
  const agent = await db.query.agents.findFirst({
    where: eq(agents.name, agentName),
  });

  if (!agent) {
    throw new Error(`Агент с именем "${agentName}" не найден в базе.`);
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
        "HTTP-Referer": "https://soundspa.ai", // Опционально для OpenRouter
        "X-Title": "SoundSpa AI Factory",
      },
      body: JSON.stringify({
        model: agent.model, // Наша NVIDIA Nemotron из базы
        messages: [
          { role: "system", content: agent.systemPrompt }, // Тот самый Watcher-промпт
          { role: "user", content: context }, // Данные о пингах, которые мы передадим
        ],
        temperature: agent.temperature,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Ошибка OpenRouter: ${data.error.message}`);
    }

    return data.choices[0].message.content;
  } catch (error) {
    console.error("Ошибка при работе агента:", error);
    throw error;
  }
}