// /app/[tenantSlug] — персональный URL кабинета салона
// Пример: /app/spaquatoria, /app/divnitsa
//
// Логика:
// 1. Проверяем сессию (middleware уже гарантирует наличие для /app/**)
// 2. Проверяем, что tenantSlug из URL совпадает с tenantSlug сессии
// 3. Загружаем каналы и данные тенанта из DB
// 4. Рендерим ResponsivePlayer (iOS или Desktop в зависимости от ширины экрана)

import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getChannelsForTenant, PROMO_CARDS } from "../ios-player/channels";
import { db } from "@/lib/db.pg";
import { eq } from "drizzle-orm";
import { tenants } from "@/db";
import { ResponsivePlayer } from "./ResponsivePlayer";

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

  return {
    title: tenant ? `${titleBase} · Sound Spa` : "Sound Spa",
  };
}

export default async function TenantPlayerPage({
  params,
}: {
  params: Promise<TenantPageParams>;
}) {
  const { tenantSlug } = await params;

  const session = await getSession();
  if (!session && !SKIP_AUTH) redirect(`/login?from=/app/${tenantSlug}`);

  // Пользователь пытается открыть чужой кабинет — редиректим на свой
  if (session && session.tenantSlug !== tenantSlug && !SKIP_AUTH) {
    redirect(`/app/${session.tenantSlug}`);
  }

  const [channels, tenant] = await Promise.all([
    getChannelsForTenant(tenantSlug),
    db.query.tenants.findFirst({ where: eq(tenants.slug, tenantSlug) }),
  ]);

  if (!tenant) notFound();

  const now = new Date();
  const paidTillDate = tenant.paidTill ? new Date(tenant.paidTill) : null;
  const trialEndsDate = tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null;

  let status: "trial" | "active" | "expired" = "expired";

  if (paidTillDate && paidTillDate > now) {
    status = "active";
  } else if (trialEndsDate && trialEndsDate > now) {
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
    // Экран блокировки при истёкшем триале/подписке
    return (
      <main
        style={{
          background: "#060608",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontFamily:
            "-apple-system, system-ui, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "rgba(8,8,12,0.9)",
            borderRadius: 16,
            padding: "24px 20px 20px",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: "rgba(195,168,108,0.7)",
              marginBottom: 8,
            }}
          >
            Sound Spa
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 500,
              margin: 0,
              marginBottom: 8,
            }}
          >
            Доступ к кабинету приостановлен
          </h1>
          <p
            style={{
              fontSize: 14,
              opacity: 0.7,
              margin: 0,
              marginBottom: 16,
            }}
          >
            Тестовый период или подписка для салона {salonName} завершились.
            Чтобы продолжить использовать Sound Spa, свяжитесь с вашей
            контактной персоной или поддержкой.
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