import {
  pgTable,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  serial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "../schema.pg";

// ---------- monitoring_current ----------

export const monitoringCurrent = pgTable("monitoring_current", {
  tenantId: integer("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),

  status: text("status").notNull().default("offline"),

  lastPing: timestamp("last_ping", { withTimezone: true }).defaultNow(),

  metadata: jsonb("metadata")
    .default(sql`'{}'::jsonb`)
    .notNull(),
});

// ---------- monitoring_logs ----------

export const monitoringLogs = pgTable(
  "monitoring_logs",
  {
    id: serial("id").primaryKey(),

    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    event: text("event").notNull(),

    level: text("level").default("info"),

    details: text("details"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tenantIdx: index("monitoring_logs_tenant_idx").on(table.tenantId),
  }),
);