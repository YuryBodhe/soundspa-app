// apps/soundspa-app/lib/utils/date-utils.ts

/**
 * Вычисляет разницу в днях между текущим моментом и датой окончания подписки.
 * Возвращает 0, если дата прошла или не установлена.
 */
export function calculateDaysRemaining(paidTill: string | Date | null): number {
  if (!paidTill) return 0;
  
  const end = new Date(paidTill).getTime();
  const now = Date.now();
  
  const diff = end - now;
  if (diff <= 0) return 0;
  
  // Округляем в большую сторону, чтобы даже 1.1 дня отображалось как 2
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}