import { sql } from "drizzle-orm";
import { v2Db } from "../client";
import { monitoringLifecycleEvents } from "../schema";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type LifecycleEvent = typeof monitoringLifecycleEvents.$inferInsert;

const PLAYBACK_ERROR_CODES = {
  music: "MUSIC_PLAYBACK_FAILED",
  ambient: "AMBIENT_PLAYBACK_FAILED",
} as const;

export async function recordLifecycleEvent(tx: V2Transaction, event: LifecycleEvent) {
  await tx.insert(monitoringLifecycleEvents).values(event);
}

async function upsertDeviceError(deviceId: string, category: "PLAYBACK" | "CATALOG_CONFIG", errorCode: string) {
  await v2Db.execute(sql`
    WITH event_clock AS (SELECT clock_timestamp() AS occurred_at)
    INSERT INTO hourly_error_aggregates
      (bucket_start, category, error_code, device_id, event_count, first_seen_at, last_seen_at)
    SELECT date_trunc('hour', event_clock.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      ${category}::monitoring_error_category, ${errorCode}, ${deviceId}::uuid, 1,
      event_clock.occurred_at, event_clock.occurred_at
    FROM event_clock
    ON CONFLICT (bucket_start, category, error_code, device_id)
      WHERE device_id IS NOT NULL
    DO UPDATE SET
      event_count = hourly_error_aggregates.event_count + 1,
      last_seen_at = EXCLUDED.last_seen_at
  `);
}

/** Device identity is always supplied by server-side credential authentication. */
export async function recordDevicePlaybackFailure(deviceId: string, lane: keyof typeof PLAYBACK_ERROR_CODES) {
  await upsertDeviceError(deviceId, "PLAYBACK", PLAYBACK_ERROR_CODES[lane]);
}

export async function recordCustomerCatalogFailure(deviceId: string) {
  await upsertDeviceError(deviceId, "CATALOG_CONFIG", "CUSTOMER_CATALOG_FAILED");
}
