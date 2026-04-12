import { cookies } from "next/headers";
import { db } from "@/lib/db.pg";
import { tenants, tenantChannels, channels } from "@/db";
import { eq } from "drizzle-orm";
import { SpaquatoriaClient, type SpaChannel } from "../../_legacy/SpaquatoriaClient";

const SESSION_COOKIE = "soundspa_session";

async function getSpaquatoriaContext() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  let payload: { tenantId: number } | null = null;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload?.tenantId) return null;

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, payload.tenantId),
  });

  if (!tenant) return null;

  const links = await db
    .select()
    .from(tenantChannels)
    .leftJoin(channels, eq(tenantChannels.channelId, channels.id))
    .where(eq(tenantChannels.tenantId, tenant.id));

  const channelList = links
    .map((row) => row.channels)
    .filter((c): c is typeof channels.$inferSelect => !!c);

  const channelsForClient: SpaChannel[] = channelList.map((c) => ({
    id: c.id,
    code: c.code,
    displayName: c.displayName,
    streamUrl: c.streamUrl,
  }));

  // Статус доступа по paid_till
  let accessLabel = "sound spa";
  const now = Date.now();
  const paidTillMs = null; // Временно отключаем paidTill

  if (paidTillMs && paidTillMs > now) {
    const diffDays = Math.ceil((paidTillMs - now) / (24 * 60 * 60 * 1000));
    accessLabel = `sound spa · trial access · осталось ${diffDays} дн.`;
  } else if (paidTillMs && paidTillMs <= now) {
    accessLabel = "sound spa · access expired";
  } else {
    accessLabel = "sound spa · access";
  }

  return { tenant, channels: channelsForClient, accessLabel };
}

export default async function AppPage() {
  const ctx = await getSpaquatoriaContext();

  if (!ctx) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#07060a",
          fontFamily: "sans-serif",
        }}
      >
        <p
          style={{
          fontSize: 10,
          letterSpacing: "0.38em",
          textTransform: "uppercase",
          fontWeight: 300,
          color: "rgba(195,168,108,0.5)",
        }}
        >
          Нет доступа — попробуйте войти снова
        </p>
      </main>
    );
  }

  const { tenant, channels, accessLabel } = ctx;

  return (
    <SpaquatoriaClient
      brandName={tenant.name ?? "Sound Spa"}
      channels={channels}
      accessLabel={accessLabel}
      backgroundUrl="/soundspa_bg.jpg"
    />
  );
}
