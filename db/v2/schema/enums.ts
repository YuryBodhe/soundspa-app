import { pgEnum } from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "manager"]);
export const channelKind = pgEnum("channel_kind", ["music", "ambient"]);
