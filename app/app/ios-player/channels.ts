// app/app/ios-player/channels.ts
import { db } from "@/lib/db.pg";
import { eq } from "drizzle-orm";
import { tenants, tenantChannels, channels } from "@/db";
// Добавляем эту строку здесь:
export const revalidate = 0;

// ── UI-ТИПЫ ──────────────────────────────────
export type TenantSlug = string;

export interface Channel {
  id: string;
  slug: string;
  title: string;
  mood: string | null;
  streamUrl: string;
  image?: string | null;
  order: number;
  isNew?: boolean;
}

export interface AmbientChannel {
  id: string;
  slug: string;      
  title: string;
  streamUrl: string; 
  order: number;
  enabled: boolean;
  image?: string | null; 
}

export interface PromoCard {
  id: string;
  tag: "promo" | "update" | "tech" | "offline";
  title: string;
  desc: string;
  linkLabel: string;
  href?: string;
}

// ── МУЗЫКАЛЬНЫЕ КАНАЛЫ (HLS) ─────────────────────────
export async function getChannelsForTenant(
  tenantSlug: TenantSlug
): Promise<Channel[]> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, tenantSlug),
  });

  if (!tenant) {
    console.warn(`[getChannelsForTenant] tenant not found: ${tenantSlug}`);
    return [];
  }

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

  rows.sort((a, b) => {
    const oa = a.tenantOrder || a.channelOrder;
    const ob = b.tenantOrder || b.channelOrder;
    return oa - ob;
  });

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

// ── ШУМОВЫЕ КАНАЛЫ (HLS ИЗ БАЗЫ) ───────────────────────────
export async function getNoiseChannelsForTenant(tenantSlug: string): Promise<AmbientChannel[]> {
  // Ищем все каналы, у которых kind = 'noise'
  const noiseChannels = await db.query.channels.findMany({
    where: eq(channels.kind, "noise")
  });

  return noiseChannels.map(ch => ({
  id:        ch.id.toString(),
  slug:      ch.slug,        // Передаем slug из базы
  title:     ch.displayName,
  streamUrl: ch.streamUrl,
  order:     ch.order,
  enabled:   true,
  image:     ch.image        // Передаем image из базы
}));
}

// ── ПРОМО-КАРТОЧКИ ───────────────────────────
export const PROMO_CARDS: PromoCard[] = [
  {
    id:        "promo_summer",
    tag:       "promo",
    title:     "Summer Package",
    desc: "New seasonal collection available now for your clients",
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