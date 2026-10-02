import { check, index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { monitoringLane } from "../enums";
import { sql } from "drizzle-orm";

export const hourlyChannelPlayback = pgTable("hourly_channel_playback", {
  bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
  deviceId: uuid("device_id").notNull(),
  channelId: uuid("channel_id").notNull(),
  lane: monitoringLane("lane").notNull(),
  playedSeconds: integer("played_seconds").notNull().default(0),
}, (table) => [
  primaryKey({ name: "hourly_channel_playback_pk", columns: [table.bucketStart, table.deviceId, table.channelId, table.lane] }),
  check("hourly_channel_playback_utc_hour_check", sql`date_trunc('hour', ${table.bucketStart} AT TIME ZONE 'UTC') = (${table.bucketStart} AT TIME ZONE 'UTC')`),
  check("hourly_channel_playback_seconds_check", sql`${table.playedSeconds} BETWEEN 0 AND 3600`),
  index("hourly_channel_playback_device_time_idx").on(table.deviceId, table.bucketStart),
  index("hourly_channel_playback_channel_time_idx").on(table.channelId, table.bucketStart),
]);
