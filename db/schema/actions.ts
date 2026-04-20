// db/schema/actions.ts

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "../schema.pg";

// ---------- agent_actions ----------

export const agentActions = pgTable(
  "agent_actions",
  {
    id: serial("id").primaryKey(),

    // к какому салону относится
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    // кто должен выполнить
    agentRole: text("agent_role").notNull(), 
    // "controller" | "support" | "marketing"

    // тип действия
    action: text("action").notNull(),
    // "detect_offline" | "notify_owner" | "check_issue"

    // гибкие данные
    payload: jsonb("payload")
      .default(sql`'{}'::jsonb`)
      .notNull(),

    // статус выполнения
    status: text("status").notNull().default("pending"),
    // pending | processing | done | failed

    // защита от дублей (например webhook)
    externalId: text("external_id"),

    // ошибка если есть
    error: text("error"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    }).defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    }).defaultNow(),

    executedAt: timestamp("executed_at", {
      withTimezone: true,
    }),
  },
  (table) => ({
    tenantIdx: index("agent_actions_tenant_idx").on(table.tenantId),
    statusIdx: index("agent_actions_status_idx").on(table.status),
  })
);