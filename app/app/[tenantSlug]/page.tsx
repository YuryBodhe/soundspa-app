// /app/[tenantSlug]/page.tsx — персональный URL кабинета салона
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getChannelsForTenant, PROMO_CARDS } from "../ios-player/channels";
import { db } from "@/lib/db.pg";
import { eq } from "drizzle-orm";
import { tenants } from "@/db";
import { ResponsivePlayer } from "./ResponsivePlayer";
import { createProdamusLink } from "@/lib/prodamus";

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

  let status: "trial" | "active" | "expired" = "expired";

  // ПРИОРИТЕТ 1: Оплата
  if (paidTillDate) {
    status = paidTillDate > now ? "active" : "expired";
  } 
  // ПРИОРИТЕТ 2: Триал (если никогда не платили)
  else if (trialEndsDate && trialEndsDate > now) {
    status = "trial";
  }

  const salonName = tenant.brandName ?? tenant.name ?? tenant.slug;

  // --- ЭКРАН БЛОКИРОВКИ С КНОПКОЙ ОПЛАТЫ ---
  if (status === "expired") {
    return (
      <main style={{
        background: "#060608", minHeight: "100vh", display: "flex", 
        alignItems: "center", justifyContent: "center", color: "white", padding: 24
      }}>
        <div style={{
          maxWidth: 480, width: "100%", background: "rgba(8,8,12,0.9)",
          borderRadius: 24, padding: "40px 32px", border: "1px solid rgba(255,255,255,0.06)",
          textAlign: "center", boxShadow: "0 20px 40px rgba(0,0,0,0.4)"
        }}>
          <div style={{ fontSize: 12, letterSpacing: "0.4em", color: "#C3A86C", marginBottom: 16, fontWeight: 600 }}>
            SOUND SPA
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 500, margin: "0 0 12px", letterSpacing: "-0.02em" }}>
            Доступ приостановлен
          </h1>
          <p style={{ fontSize: 15, opacity: 0.6, margin: "0 0 32px", lineHeight: "1.6" }}>
            Подписка или тестовый период для салона <br/><b>{salonName}</b> завершились.
          </p>
          
          <a 
            href={createProdamusLink(tenantSlug, 3000)} 
            style={{
              display: "inline-block",
              padding: "16px 40px",
              background: "#C3A86C",
              color: "black",
              borderRadius: 12,
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 16,
              boxShadow: "0 8px 20px rgba(195,168,108,0.25)",
              transition: "transform 0.2s ease"
            }}
          >
            Продлить доступ — 3000₽
          </a>
          
          <div style={{ marginTop: 24, fontSize: 12, opacity: 0.4 }}>
            После оплаты доступ восстановится автоматически
          </div>
        </div>
      </main>
    );
  }

  // --- ГРАФИК РАБОТЫ (ДЛЯ ИНТЕРФЕЙСА) ---
  const subscriptionDate =
    status === "active" && paidTillDate
      ? `Подписка активна до ${paidTillDate.toLocaleDateString("ru-RU", {
          day: "numeric", month: "long", year: "numeric",
        })}`
      : status === "trial" && trialEndsDate
      ? `Тестовый период до ${trialEndsDate.toLocaleDateString("ru-RU", {
          day: "numeric", month: "long", year: "numeric",
        })}`
      : "Доступ неактивен";

  const subscriptionWarn =
    (status === "active" &&
      paidTillDate &&
      paidTillDate.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) ||
    (status === "trial" &&
      trialEndsDate &&
      trialEndsDate.getTime() - now.getTime() < 3 * 24 * 60 * 60 * 1000);

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