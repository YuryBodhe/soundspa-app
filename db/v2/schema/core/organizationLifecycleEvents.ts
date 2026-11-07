import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Snapshot audit rows intentionally have no Organization FK so they survive deletion. */
export const organizationLifecycleEvents = pgTable("organization_lifecycle_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  organizationName: text("organization_name").notNull(),
  action: text("action").notNull(),
  operator: text("operator").notNull(),
  reason: text("reason").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("organization_lifecycle_events_org_time_idx").on(table.organizationId, table.occurredAt),
  check("organization_lifecycle_events_action_valid", sql`${table.action} IN ('archived', 'restored')`),
  check("organization_lifecycle_events_operator_nonempty", sql`length(btrim(${table.operator})) BETWEEN 1 AND 200`),
  check("organization_lifecycle_events_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 12 AND 500`),
  check("organization_lifecycle_events_name_nonempty", sql`length(btrim(${table.organizationName})) > 0`),
]);
