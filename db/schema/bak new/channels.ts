import { pgTable, serial, text, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenants } from "./tenants";

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  mood: text("mood"),
  kind: text("kind").notNull().default("music"),
  streamUrl: text("stream_url").notNull(),
  image: text("image"),
  order: integer("order").notNull().default(0),
  isNew: boolean("is_new").notNull().default(false),
});

export const tenantChannels = pgTable("tenant_channels", {
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  channelId: integer("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  order: integer("order").notNull().default(0),
}, (table) => ({
  pk: uniqueIndex("tenant_channels_pk").on(table.tenantId, table.channelId),
}));

export const channelRelations = relations(channels, ({ many }) => ({
  tenantChannels: many(tenantChannels),
}));

export const tenantChannelsRelations = relations(tenantChannels, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantChannels.tenantId], references: [tenants.id] }),
  channel: one(channels, { fields: [tenantChannels.channelId], references: [channels.id] }),
}));