import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenants } from "../core/tenants";
import { channels } from "./channels";
import { timestamps } from "../utils";

export const devices = pgTable(
  "devices",
  {
    id: serial("id").primaryKey(),

    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    // Уникальный ID самого железа/браузера (UUID или Fingerprint)
    deviceUid: text("device_uid").notNull().unique(),

    name: text("name").notNull(), // "Main Hall", "Spa Room 1"

    // Прямая связь: какой канал включен прямо сейчас
    currentChannelId: integer("current_channel_id")
  .notNull() // 1. Гарантируем наличие данных
  .references(() => channels.id, { onDelete: "restrict" }), // 2. Запрещаем удаление «под корень»

    // "Пульс" устройства
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),

    ...timestamps,
  },
  (table) => ({
    // Защита: нельзя создать два устройства с одинаковым именем в одном салоне
    nameTenantIdx: uniqueIndex("device_name_tenant_idx").on(table.tenantId, table.name),
  })
);

export const devicesRelations = relations(devices, ({ one }) => ({
  tenant: one(tenants, {
    fields: [devices.tenantId],
    references: [tenants.id],
  }),
  channel: one(channels, {
    fields: [devices.currentChannelId],
    references: [channels.id],
  }),
}));