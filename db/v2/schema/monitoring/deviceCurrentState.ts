import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { channels } from "../product/channels";
import { devicePlaybackState } from "../enums";
import { devices } from "./devices";

export const deviceCurrentState = pgTable("device_current_state", {
  deviceId: uuid("device_id").primaryKey().references(() => devices.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastPlaybackAt: timestamp("last_playback_at", { withTimezone: true }),
  // Preserve legacy SQL column names; these now explicitly represent the MUSIC lane.
  musicPlaybackState: devicePlaybackState("playback_state").notNull().default("idle"),
  musicCurrentChannelId: uuid("current_channel_id").references(() => channels.id, { onDelete: "set null" }),
  musicSessionId: uuid("music_session_id"),
  musicSequence: bigint("music_sequence", { mode: "number" }),
  ambientPlaybackState: devicePlaybackState("ambient_playback_state").notNull().default("idle"),
  ambientCurrentChannelId: uuid("ambient_current_channel_id").references(() => channels.id, { onDelete: "set null" }),
  ambientSessionId: uuid("ambient_session_id"),
  ambientSequence: bigint("ambient_sequence", { mode: "number" }),
  clientVersion: text("client_version"),
  lastErrorCode: text("last_error_code"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("device_current_state_last_seen_idx").on(table.lastSeenAt),
  check("device_current_state_music_signal_check", sql`(${table.musicSessionId} IS NULL AND ${table.musicSequence} IS NULL) OR (${table.musicSessionId} IS NOT NULL AND ${table.musicSequence} IS NOT NULL AND ${table.musicSequence} >= 0)`),
  check("device_current_state_ambient_signal_check", sql`(${table.ambientSessionId} IS NULL AND ${table.ambientSequence} IS NULL) OR (${table.ambientSessionId} IS NOT NULL AND ${table.ambientSequence} IS NOT NULL AND ${table.ambientSequence} >= 0)`),
]);
