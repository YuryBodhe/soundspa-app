import { pgTable, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenants } from "../core/tenants";
import { channels } from "./channels";

export const tenantChannels = pgTable(
  "tenant_channels",
  {
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    order: integer("order").notNull().default(0),
  },
  (table) => ({
    pk: uniqueIndex("tenant_channels_pk").on(table.tenantId, table.channelId),
  })
);

export const tenantChannelsRelations = relations(tenantChannels, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantChannels.tenantId], references: [tenants.id] }),
  channel: one(channels, { fields: [tenantChannels.channelId], references: [channels.id] }),
}));