import { pgEnum } from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "manager"]);
export const channelKind = pgEnum("channel_kind", ["music", "ambient"]);
export const entitlementType = pgEnum("entitlement_type", ["included", "preview", "subscribed"]);
