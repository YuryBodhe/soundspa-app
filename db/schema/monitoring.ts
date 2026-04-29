import {
  pgTable,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  serial,
  boolean,
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

    channelId: text("channel_id"),

    sessionId: text("session_id"),

    eventType: text("event_type"),

    event: text("event").notNull(),

    level: text("level").default("info"),

    details: text("details"),

    userAgent: text("user_agent"),

    clientType: text("client_type"),

    isBuffering: boolean("is_buffering").notNull().default(false),

    noiseId: text("noise_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tenantIdx: index("monitoring_logs_tenant_idx").on(table.tenantId),
  }),
);

// ---------- monitoring_reports (НОВАЯ ТАБЛИЦА) ----------

export const monitoringReports = pgTable("monitoring_reports", {
  id: serial("id").primaryKey(),

  tenantId: integer("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" }),

  agentName: text("agent_name").notNull(),

  type: text("type").default("technical"),

  content: text("content").notNull(),

  status: text("status").default("ok"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});