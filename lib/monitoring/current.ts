import { db } from "@/lib/db.pg";
import { monitoringCurrent, monitoringLogs } from "@/db/schema/monitoring";
import { and, eq, lt } from "drizzle-orm";

export type MonitoringMetadata = Record<string, unknown> & {
  device?: string;
  noiseId?: string | number;
  channelId?: string | number;
  sessionId?: string;
  eventType?: string;
};

export type MonitoringEventPayload = {
  tenantId: number;
  event: string;
  eventType?: string | null;
  sessionId?: string | null;
  channelId?: number | null;
  metadata?: MonitoringMetadata;
  level?: "info" | "warn" | "error";
  details?: string | null;
  userAgent?: string | null;
  clientType?: string | null;
};

export async function logMonitoringEvent(payload: MonitoringEventPayload) {
  const {
    tenantId,
    event,
    eventType,
    sessionId,
    channelId,
    metadata,
    level = "info",
    details,
    userAgent,
    clientType,
  } = payload;

  await db.insert(monitoringLogs).values({
    tenantId,
    event,
    eventType: eventType ?? null,
    sessionId: sessionId ?? null,
    channelId: channelId ?? null,
    level,
    details: details ?? (metadata ? JSON.stringify(metadata) : null),
    userAgent: userAgent ?? null,
    clientType: clientType ?? null,
  });
}

export async function upsertMonitoringCurrent(params: {
  tenantId: number;
  status?: string;
  metadata?: MonitoringMetadata;
  lastPing?: Date;
}) {
  const { tenantId, status = "online", metadata = {}, lastPing = new Date() } = params;

  await db
    .insert(monitoringCurrent)
    .values({
      tenantId,
      status,
      lastPing,
      metadata,
    })
    .onConflictDoUpdate({
      target: monitoringCurrent.tenantId,
      set: {
        status,
        lastPing,
        metadata,
      },
    });
}

export async function markTenantsOffline(staleMinutes: number) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  await db
    .update(monitoringCurrent)
    .set({ status: "offline" })
    .where(
      and(
        eq(monitoringCurrent.status, "online"),
        lt(monitoringCurrent.lastPing, cutoff),
      ),
    );
}