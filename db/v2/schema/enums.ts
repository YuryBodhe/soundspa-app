import { pgEnum } from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "manager"]);
export const channelKind = pgEnum("channel_kind", ["music", "ambient"]);
export const entitlementType = pgEnum("entitlement_type", ["included", "preview", "subscribed"]);
export const deviceStatus = pgEnum("device_status", ["active", "revoked"]);
export const devicePlaybackState = pgEnum("device_playback_state", ["idle", "playing", "paused", "buffering", "error"]);
export const deviceEventType = pgEnum("device_event_type", ["session_started", "playback_started", "playback_stopped", "channel_changed", "playback_error", "player_recovered"]);
export const monitoringLane = pgEnum("monitoring_lane", ["music", "ambient"]);
export const monitoringErrorCategory = pgEnum("monitoring_error_category", ["AUTH", "PLAYBACK", "MEDIA_FETCH", "CATALOG_CONFIG"]);
export const monitoringLifecycleEventType = pgEnum("monitoring_lifecycle_event_type", [
  "organization_created", "organization_deleted",
  "location_created", "location_deleted",
  "device_created", "device_activated", "device_revoked", "device_deleted",
]);
export const commercialProductKind = pgEnum("commercial_product_kind", ["core", "partner", "addon"]);
export const commercialTrialStatus = pgEnum("commercial_trial_status", ["active", "expired"]);
export const commercialSubscriptionStatus = pgEnum("commercial_subscription_status", ["active", "past_due", "canceled", "expired"]);
export const commercialProvider = pgEnum("commercial_provider", ["manual", "staging", "prodamus"]);
export const commercialOfferGrantType = pgEnum("commercial_offer_grant_type", ["partner_benefit", "trial"]);
