import { timestamp, uuid, pgTable } from "drizzle-orm/pg-core";
import { channels } from "../product/channels";

export const baseChannels = pgTable("base_channels", {
  channelId: uuid("channel_id").primaryKey().references(() => channels.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
