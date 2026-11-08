import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { commercialProducts } from "../commercialProducts";
import { devices } from "./devices";

/** Product-specific Device authorization history. A revoked row is retained. */
export const deviceProductAssignments = pgTable("device_product_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id").notNull(),
  productId: uuid("product_id").notNull(),
  source: text("source").$type<"legacy_basic_backfill" | "device_activation" | "operator">().notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  assignedBy: text("assigned_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  revokeReason: text("revoke_reason"),
}, (table) => [
  foreignKey({ name: "device_product_assignments_device_fk", columns: [table.deviceId], foreignColumns: [devices.id] }).onDelete("cascade"),
  foreignKey({ name: "device_product_assignments_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  uniqueIndex("device_product_assignments_active_unique").on(table.deviceId, table.productId).where(sql`${table.revokedAt} IS NULL`),
  index("device_product_assignments_device_idx").on(table.deviceId, table.revokedAt),
  index("device_product_assignments_product_idx").on(table.productId, table.revokedAt),
  check("device_product_assignments_source_valid", sql`${table.source} IN ('legacy_basic_backfill', 'device_activation', 'operator')`),
  check("device_product_assignments_revocation_shape", sql`
    (${table.revokedAt} IS NULL AND ${table.revokedBy} IS NULL AND ${table.revokeReason} IS NULL) OR
    (${table.revokedAt} IS NOT NULL AND ${table.revokedBy} IS NOT NULL AND length(btrim(${table.revokedBy})) BETWEEN 1 AND 160 AND ${table.revokeReason} IS NOT NULL AND length(btrim(${table.revokeReason})) BETWEEN 1 AND 500)
  `),
]);
