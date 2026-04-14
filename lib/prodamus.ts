export function createProdamusLink(tenantSlug: string, amount: number) {
  // Когда получишь домен от Продамуса (например, soundspa.prodamus.ru), замени здесь
  const baseUrl = "https://demo.prodamus.ru"; 
  
  const params = new URLSearchParams({
    do: "pay",
    out_summ: amount.toString(),
    // Используем slug, чтобы в вебхуке понять, кто платит
    order_id: `pay_${tenantSlug}_${Date.now()}`, 
    customer_extra: tenantSlug, 
    products: JSON.stringify([{
      name: `Подписка Sound Spa`,
      quantity: 1,
      price: amount
    }])
  });

  return `${baseUrl}?${params.toString()}`;
}