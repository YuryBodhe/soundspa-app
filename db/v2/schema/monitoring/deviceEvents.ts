import { index, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { channels } from "../product/channels";
import { deviceEventType } from "../enums";
import { devices } from "./devices";

export const deviceEvents = pgTable("device_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  eventType: deviceEventType("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
  details: jsonb("details"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("device_events_processing_idx").on(table.processedAt, table.occurredAt),
  index("device_events_device_time_idx").on(table.deviceId, table.occurredAt),
]);
