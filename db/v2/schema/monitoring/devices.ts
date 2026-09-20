import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { deviceStatus } from "../enums";
import { locations } from "../core/locations";

export const devices = pgTable("devices", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "restrict" }),
  credentialHash: text("credential_hash").notNull(),
  status: deviceStatus("status").notNull().default("active"),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("devices_credential_hash_unique").on(table.credentialHash),
  index("devices_location_idx").on(table.locationId),
  index("devices_location_revoked_idx").on(table.locationId, table.revokedAt),
]);
