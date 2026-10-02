import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { monitoringLifecycleEventType } from "../enums";

// Snapshot identifiers intentionally have no FKs so the audit history survives deletion.
export const monitoringLifecycleEvents = pgTable("monitoring_lifecycle_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventType: monitoringLifecycleEventType("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  organizationId: uuid("organization_id"),
  organizationName: text("organization_name"),
  locationId: uuid("location_id"),
  locationName: text("location_name"),
  deviceId: uuid("device_id"),
  deviceLabel: text("device_label"),
}, (table) => [
  index("monitoring_lifecycle_events_time_idx").on(table.occurredAt),
  index("monitoring_lifecycle_events_org_time_idx").on(table.organizationId, table.occurredAt),
  index("monitoring_lifecycle_events_location_time_idx").on(table.locationId, table.occurredAt),
  index("monitoring_lifecycle_events_device_time_idx").on(table.deviceId, table.occurredAt),
]);
