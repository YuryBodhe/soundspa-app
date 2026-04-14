// /app/[tenantSlug] — персональный URL кабинета салона
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getChannelsForTenant, PROMO_CARDS } from "../ios-player/channels";
import { db } from "@/lib/db.pg";
import { eq } from "drizzle-orm";
import { tenants } from "@/db";
import { ResponsivePlayer } from "./ResponsivePlayer";

// ОТКЛЮЧАЕМ КЭШ: чтобы правки в админке срабатывали мгновенно
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TenantPageParams {
  tenantSlug: string;
}

const SKIP_AUTH =
  process.env.NODE_ENV !== "production" &&
  process.env.DEV_DISABLE_AUTH === "true";

export async function generateMetadata({
  params,
}: {
  params: Promise<TenantPageParams>;
}) {
  const { tenantSlug } = await params;
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, tenantSlug),
  });
  const titleBase = tenant?.brandName ?? tenant?.name ?? tenantSlug;
  return { title: tenant ? `${titleBase} · Sound Spa` : "Sound Spa" };
}

export default async function TenantPlayerPage({
  params,
}: {
  params: Promise<TenantPageParams>;
}) {
  const { tenantSlug } = await params;

  const session = await getSession();
  if (!session && !SKIP_AUTH) redirect(`/login?from=/app/${tenantSlug}`);

  if (session && session.tenantSlug !== tenantSlug && !SKIP_AUTH) {
    redirect(`/app/${session.tenantSlug}`);
  }

  const [channels, tenant] = await Promise.all([
    getChannelsForTenant(tenantSlug),
    db.query.tenants.findFirst({ where: eq(tenants.slug, tenantSlug) }),
  ]);

  if (!tenant) notFound();

  // --- ЛОГИКА ПРОВЕРКИ ПОДПИСКИ ---
  const now = new Date();
  const paidTillDate = tenant.paidTill ? new Date(tenant.paidTill) : null;
  const trialEndsDate = tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null;

  // ЛОГИ ДЛЯ ОТЛАДКИ: увидишь их в `pm2 logs`
  console.log(`[Subscription Check] Salon: ${tenantSlug}`);
  console.log(`- Current Time: ${now.toISOString()}`);
  console.log(`- Paid Till: ${paidTillDate?.toISOString() || 'NULL'}`);
  console.log(`- Trial Ends: ${trialEndsDate?.toISOString() || 'NULL'}`);

  let status: "trial" | "active" | "expired" = "expired";

  // ПРИОРИТЕТ 1: Если есть оплата, проверяем её.
  // Если оплата просрочена, мы НЕ смотрим на триал (считаем, что триал сгорает при первой оплате)
  if (paidTillDate) {
    if (paidTillDate > now) {
      status = "active";
    } else {
      status = "expired";
    }
  } 
  // ПРИОРИТЕТ 2: Если оплаты еще никогда не было, проверяем триал
  else if (trialEndsDate && trialEndsDate > now) {
    status = "trial";
  }

  const subscriptionDate =
    status === "active" && paidTillDate
      ? `Подписка активна до ${paidTillDate.toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}`
      : status === "trial" && trialEndsDate
      ? `Тестовый период до ${trialEndsDate.toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}`
      : "Доступ неактивен";

  const subscriptionWarn =
    (status === "active" &&
      paidTillDate &&
      paidTillDate.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) ||
    (status === "trial" &&
      trialEndsDate &&
      trialEndsDate.getTime() - now.getTime() < 3 * 24 * 60 * 60 * 1000);

  const salonName = tenant.brandName ?? tenant.name ?? tenant.slug;

  if (status === "expired") {
    return (
      <main style={{
        background: "#060608", minHeight: "100vh", display: "flex", 
        alignItems: "center", justifyContent: "center", color: "white", padding: 24
      }}>
        <div style={{
          maxWidth: 480, width: "100%", background: "rgba(8,8,12,0.9)",
          borderRadius: 16, padding: "24px 20px 20px", border: "1px solid rgba(255,255,255,0.06)"
        }}>
          <div style={{ fontSize: 12, letterSpacing: "0.28em", color: "rgba(195,168,108,0.7)", marginBottom: 8 }}>
            SOUND SPA
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 8px" }}>
            Доступ приостановлен
          </h1>
          <p style={{ fontSize: 14, opacity: 0.7, margin: "0 0 16px" }}>
            Подписка или тестовый период для салона <b>{salonName}</b> завершились.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: "#060608", minHeight: "100vh" }}>
      <ResponsivePlayer
        tenantSlug={tenantSlug}
        salonName={salonName}
        channels={channels}
        promoCards={PROMO_CARDS}
        subscriptionDate={subscriptionDate}
        subscriptionWarn={!!subscriptionWarn}
      />
    </main>
  );
}