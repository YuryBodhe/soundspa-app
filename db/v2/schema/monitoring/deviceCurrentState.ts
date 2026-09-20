import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { channels } from "../product/channels";
import { devicePlaybackState } from "../enums";
import { devices } from "./devices";

export const deviceCurrentState = pgTable("device_current_state", {
  deviceId: uuid("device_id").primaryKey().references(() => devices.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastPlaybackAt: timestamp("last_playback_at", { withTimezone: true }),
  playbackState: devicePlaybackState("playback_state").notNull().default("idle"),
  currentChannelId: uuid("current_channel_id").references(() => channels.id, { onDelete: "set null" }),
  clientVersion: text("client_version"),
  lastErrorCode: text("last_error_code"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("device_current_state_last_seen_idx").on(table.lastSeenAt),
]);
