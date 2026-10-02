import { check, index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const hourlyDevicePlayback = pgTable("hourly_device_playback", {
  bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
  deviceId: uuid("device_id").notNull(),
  activePlaybackSeconds: integer("active_playback_seconds").notNull().default(0),
}, (table) => [
  primaryKey({ name: "hourly_device_playback_pk", columns: [table.bucketStart, table.deviceId] }),
  check("hourly_device_playback_utc_hour_check", sql`date_trunc('hour', ${table.bucketStart} AT TIME ZONE 'UTC') = (${table.bucketStart} AT TIME ZONE 'UTC')`),
  check("hourly_device_playback_seconds_check", sql`${table.activePlaybackSeconds} BETWEEN 0 AND 3600`),
  index("hourly_device_playback_device_time_idx").on(table.deviceId, table.bucketStart),
]);
