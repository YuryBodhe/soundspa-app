// /app/ios-player — редирект на персональный URL тенанта
// После логина пользователь попадает сюда, отсюда → /app/[tenantSlug]

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function IosPlayerPage() {
  const session = await getSession();

  // Нет сессии — отправляем на логин
  if (!session) {
    redirect("/login");
  }

  // На всякий случай: если по какой-то причине в сессии нет tenantSlug,
  // лучше отправить на логин, чем на /app/undefined
  if (!session.tenantSlug) {
    redirect("/login");
  }

  redirect(`/app/${session.tenantSlug}`);
}
