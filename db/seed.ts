// db/seed.ts
// ─────────────────────────────────────────────
// Seed: создаёт базовые каналы и тенантов.
// Запуск: npx tsx db/seed.ts
// Безопасен для повторного запуска (upsert через onConflictDoNothing).
// ─────────────────────────────────────────────

import { db } from "./index";
import { tenants, channels, tenantChannels } from "./schema";

async function seed() {
  console.log("▶ Seeding...");

  // ── CHANNELS ────────────────────────────────

  const channelData = [
    {
      code:        "deep_relax",
      slug:        "deep-relax",
      displayName: "Deep Relax Mix",
      mood:        "Relaxing · Live",
      streamUrl:   "https://radio.bodhemusic.com/listen/deep_relax/radio.mp3",
      image:       "/channel-1.jpg",
      order:       1,
      isNew:       false,
    },
    {
      code:        "spaquatoria_healing",
      slug:        "spaquatoria-healing",
      displayName: "Healing Mix",
      mood:        "Deep · Live",
      streamUrl:   "https://radio.bodhemusic.com/listen/spaquatoria_healing/radio.mp3",
      image:       "/channel-2.jpg",
      order:       2,
      isNew:       true,
    },
    {
      code:        "dynamic_spa",
      slug:        "dynamic-spa",
      displayName: "Dynamic Spa Mix",
      mood:        "Energizing · Live",
      streamUrl:   "https://radio.bodhemusic.com/listen/dynamic_spa/radio.mp3",
      image:       "/channel-3.jpg",
      order:       3,
      isNew:       false,
    },
    {
      code:        "divnitsa",
      slug:        "divnitsa",
      displayName: "Дивница",
      mood:        "Signature · Live",
      streamUrl:   "https://radio.bodhemusic.com/listen/divnitsa/radio.mp3",
      image:       "/channel-divnitsa.jpg",
      order:       1,
      isNew:       false,
    },
  ];

  await db.insert(channels).values(channelData).onConflictDoNothing();
  console.log("  ✓ channels");

  // ── TENANTS ─────────────────────────────────

  const tenantData = [
    { slug: "spaquatoria", brandName: "Spaquatoria",
      paidTill: new Date("2026-04-12") },
    { slug: "divnitsa",    brandName: "Дивница",
      paidTill: new Date("2026-12-31") },
  ];

  await db.insert(tenants).values(tenantData).onConflictDoNothing();
  console.log("  ✓ tenants");

  // ── TENANT → CHANNELS ────────────────────────
  // Читаем ID из БД после вставки (нужны числовые id)

  const allChannels = await db.query.channels.findMany();
  const allTenants  = await db.query.tenants.findMany();

  const bySlug = (slug: string) =>
    allChannels.find(c => c.slug === slug)!;
  const tenantBySlug = (slug: string) =>
    allTenants.find(t => t.slug === slug)!;

  const spaquatoria = tenantBySlug("spaquatoria");
  const divnitsa    = tenantBySlug("divnitsa");

  const mappings = [
    // Spaquatoria: Deep Relax, Dynamic Spa, Healing
    { tenantId: spaquatoria.id, channelId: bySlug("deep-relax").id,             order: 1 },
    { tenantId: spaquatoria.id, channelId: bySlug("dynamic-spa").id,            order: 2 },
    { tenantId: spaquatoria.id, channelId: bySlug("spaquatoria-healing").id,    order: 3 },
    // Divnitsa: Дивница, Deep Relax, Dynamic Spa
    { tenantId: divnitsa.id,    channelId: bySlug("divnitsa").id,               order: 1 },
    { tenantId: divnitsa.id,    channelId: bySlug("deep-relax").id,             order: 2 },
    { tenantId: divnitsa.id,    channelId: bySlug("dynamic-spa").id,            order: 3 },
  ];

  await db.insert(tenantChannels).values(mappings).onConflictDoNothing();
  console.log("  ✓ tenant_channels");

  console.log("✅ Seed complete");
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
