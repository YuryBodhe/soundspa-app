import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { monitoringErrorCategory } from "../enums";

export const hourlyErrorAggregates = pgTable("hourly_error_aggregates", {
  bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
  category: monitoringErrorCategory("category").notNull(),
  errorCode: text("error_code").notNull(),
  deviceId: uuid("device_id"),
  eventCount: integer("event_count").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("hourly_error_aggregates_utc_hour_check", sql`date_trunc('hour', ${table.bucketStart} AT TIME ZONE 'UTC') = (${table.bucketStart} AT TIME ZONE 'UTC')`),
  check("hourly_error_aggregates_code_check", sql`${table.errorCode} ~ '^[A-Z0-9_]{1,64}$'`),
  check("hourly_error_aggregates_count_check", sql`${table.eventCount} > 0`),
  check("hourly_error_aggregates_time_check", sql`${table.firstSeenAt} <= ${table.lastSeenAt}`),
  uniqueIndex("hourly_error_aggregates_global_unique_idx")
    .on(table.bucketStart, table.category, table.errorCode)
    .where(sql`${table.deviceId} IS NULL`),
  uniqueIndex("hourly_error_aggregates_device_unique_idx")
    .on(table.bucketStart, table.category, table.errorCode, table.deviceId)
    .where(sql`${table.deviceId} IS NOT NULL`),
  index("hourly_error_aggregates_time_idx").on(table.bucketStart),
  index("hourly_error_aggregates_device_time_idx").on(table.deviceId, table.bucketStart),
  index("hourly_error_aggregates_category_time_idx").on(table.category, table.bucketStart),
]);
