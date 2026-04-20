import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { devices } from "./devices";

// ====================
// monitoring_current
// ====================

export const monitoringCurrent = pgTable(
  "monitoring_current",
  {
    deviceId: integer("device_id")
      .primaryKey()
      .references(() => devices.id, { onDelete: "cascade" }),

    // online | offline | error
    status: text("status").notNull().default("offline"),

    // Последний heartbeat
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull(),

    lastOfflineAt: timestamp("last_offline_at", {
      withTimezone: true,
    }),

    lastOnlineAt: timestamp("last_online_at", {
      withTimezone: true,
    }),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    deviceIdx: index("monitoring_current_device_idx").on(table.deviceId),
  })
);

// ====================
// monitoring_logs
// ====================

export const monitoringLogs = pgTable(
  "monitoring_logs",
  {
    id: serial("id").primaryKey(),

    deviceId: integer("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),

    // Тип события:
    // heartbeat | offline | online | error | channel_changed
    type: text("type").notNull(),

    // payload лучше назвать metadata (семантически чище)
    metadata: jsonb("metadata"),

    // info | warning | error
    level: text("level").notNull().default("info"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    deviceIdx: index("monitoring_logs_device_idx").on(table.deviceId),
    createdAtIdx: index("monitoring_logs_created_at_idx").on(
      table.createdAt
    ),
  })
);

// ====================
// relations
// ====================

export const monitoringCurrentRelations = relations(
  monitoringCurrent,
  ({ one }) => ({
    device: one(devices, {
      fields: [monitoringCurrent.deviceId],
      references: [devices.id],
    }),
  })
);

export const monitoringLogsRelations = relations(
  monitoringLogs,
  ({ one }) => ({
    device: one(devices, {
      fields: [monitoringLogs.deviceId],
      references: [devices.id],
    }),
  })
);