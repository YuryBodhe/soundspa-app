// apps/soundspa-app/app/api/webhooks/prodamus/route.ts
import { extendTenantSubscription } from "@/actions/subscriptions";

export async function POST(req: Request) {
  const data = await req.json();
  
  // 1. Проверяем подпись (безопасность)
  // 2. Получаем tenantId и сумму из метаданных платежа
  const { tenantId, amount } = data; 
  
  // 3. Определяем количество дней по сумме
  let days = 30;
  if (amount >= 12000) days = 365; // Пример: 12к — это год

  const result = await extendTenantSubscription(Number(tenantId), days);
  
  if (result.success) {
    return new Response("OK", { status: 200 });
  } else {
    return new Response("Error", { status: 500 });
  }
}