export const DAILY_MESSAGES: string[] = [
  "Сегодня хорошее время, чтобы замедлиться.",
  "Твоя тишина — тоже музыка.",
  "Одно глубокое дыхание иногда важнее, чем ещё одна задача.",
];

export function getDailyMessage(date: Date = new Date()): string {
  if (!DAILY_MESSAGES.length) return "";
  const day = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  const idx = day % DAILY_MESSAGES.length;
  return DAILY_MESSAGES[idx];
}
