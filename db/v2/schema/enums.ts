import { pgEnum } from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "manager"]);
export const channelKind = pgEnum("channel_kind", ["music", "ambient"]);
export const entitlementType = pgEnum("entitlement_type", ["included", "preview", "subscribed"]);
export const deviceStatus = pgEnum("device_status", ["active", "revoked"]);
export const devicePlaybackState = pgEnum("device_playback_state", ["idle", "playing", "paused", "buffering", "error"]);
export const deviceEventType = pgEnum("device_event_type", ["session_started", "playback_started", "playback_stopped", "channel_changed", "playback_error", "player_recovered"]);
