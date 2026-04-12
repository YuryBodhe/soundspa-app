// app/app/ios-player/channels.ts
// ─────────────────────────────────────────────
//
// ИЗМЕНЕНИЯ (admin task):
//   - getChannelsForTenant() теперь async и читает из БД
//   - Статические ALL_CHANNELS / TENANT_CHANNEL_SLUGS убраны
//   - Типы Channel / AmbientChannel / PromoCard оставлены
//   - PROMO_CARDS оставлены статическими (пока не в БД)
//   - CHANNELS-алиас убран (был для совместимости — больше не нужен)
// ─────────────────────────────────────────────

import { db } from "@/lib/db.pg";
import { eq } from "drizzle-orm";
import { tenants, tenantChannels, channels } from "@/db";

// ── UI-ТИПЫ ──────────────────────────────────
// Эти типы — граница между БД и компонентом IosPlayer.
// IosPlayer не знает о Drizzle-схеме, только об этих типах.

export type TenantSlug = string;

export interface Channel {
  id: string;
  slug: string;
  title: string;
  mood: string | null;
  streamUrl: string;
  image: string | null;
  order: number;
  isNew?: boolean;
}

// Ambient — структура готова, логика в следующем таске
export interface AmbientChannel {
  id: string;
  slug: string;
  title: string;
  streamUrl: string;
  order: number;
  enabled: boolean;
}

export interface PromoCard {
  id: string;
  tag: "promo" | "update" | "tech" | "offline";
  title: string;
  desc: string;
  linkLabel: string;
  href?: string;
}

// ── ОСНОВНАЯ ФУНКЦИЯ ─────────────────────────

/**
 * Возвращает каналы для тенанта из БД.
 * Порядок: tenant_channels.order (per-tenant), fallback → channels.order.
 *
 * Если тенант не найден — возвращает [].
 * Вызывается из Server Component (page.tsx), не из клиента.
 */
export async function getChannelsForTenant(
  tenantSlug: TenantSlug
): Promise<Channel[]> {
  // 1. Найти тенанта по slug
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, tenantSlug),
  });

  if (!tenant) {
    console.warn(`[getChannelsForTenant] tenant not found: ${tenantSlug}`);
    return [];
  }

  // 2. Загрузить привязанные каналы с join
  const rows = await db
    .select({
      id:          channels.id,
      slug:        channels.slug,
      displayName: channels.displayName,
      mood:        channels.mood,
      streamUrl:   channels.streamUrl,
      image:       channels.image,
      channelOrder: channels.order,
      isNew:       channels.isNew,
      tenantOrder: tenantChannels.order,
    })
    .from(tenantChannels)
    .innerJoin(channels, eq(tenantChannels.channelId, channels.id))
    .where(eq(tenantChannels.tenantId, tenant.id));

  // 3. Сортировка: per-tenant order, если 0 — channel.order
  rows.sort((a, b) => {
    const oa = a.tenantOrder || a.channelOrder;
    const ob = b.tenantOrder || b.channelOrder;
    return oa - ob;
  });

  // 4. Маппинг в UI-тип Channel
  return rows.map(r => ({
    id:        String(r.id),
    slug:      r.slug,
    title:     r.displayName,
    mood:      r.mood,
    streamUrl: r.streamUrl,
    image:     r.image,
    order:     r.tenantOrder || r.channelOrder,
    isNew:     r.isNew ?? false,
  }));
}

// ── ПРОМО-КАРТОЧКИ ───────────────────────────
// Пока статические. В будущем — тоже в БД.

export const PROMO_CARDS: PromoCard[] = [
  {
    id:        "promo_summer",
    tag:       "promo",
    title:     "Summer Package",
    desc:      "New seasonal collection available now for your clients",
    linkLabel: "Learn more →",
    href:      "#",
  },
  {
    id:        "update_mixes",
    tag:       "update",
    title:     "2 new mixes added",
    desc:      "Evening Ritual & Morning Flow are now live",
    linkLabel: "Details →",
    href:      "#",
  },
  {
    id:        "offline",
    tag:       "offline",
    title:     "Local Mix",
    desc:      "Available without internet connection",
    linkLabel: "Enable →",
  },
];
// NOISE CHANNELS FROM DB
export async function getNoiseChannelsForTenant(tenantSlug: string): Promise<any[]> { const { db } = await import("@/lib/db.pg"); const { eq } = await import("drizzle-orm"); const { channels } = await import("@/db"); const noiseChannels = await db. query.channels.findMany({ where: eq(channels.kind, "noise") }); return noiseChannels.map(ch => ({ id: ch.id.toString(), slug: ch.slug, title: ch.displayName, streamUrl: ch.streamUrl, order: ch.order, enabled: true })); }
