import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { devices } from "./devices";

/**
 * Permanent idempotency tombstones. User/Location IDs are retained as non-FK
 * context so deleting a Device or account cannot make an operation replayable.
 */
export const deviceCurrentBrowserOperations = pgTable("device_current_browser_operations", {
  operationHash: text("operation_hash").primaryKey(),
  authenticatedUserId: uuid("authenticated_user_id").notNull(),
  locationId: uuid("location_id").notNull(),
  deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("device_current_browser_operations_device_unique").on(table.deviceId),
  index("device_current_browser_operations_expiry_idx").on(table.expiresAt),
  check("device_current_browser_operations_hash_format", sql`${table.operationHash} ~ '^[0-9a-f]{64}$'`),
  check("device_current_browser_operations_expiry_window", sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '15 minutes'`),
]);
