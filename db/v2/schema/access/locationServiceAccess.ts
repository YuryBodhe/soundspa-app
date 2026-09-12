import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { locations } from "../core/locations";

// Current operational projection, not billing history. Missing row denies service.
export const locationServiceAccess = pgTable("location_service_access", {
  locationId: uuid("location_id").primaryKey().references(() => locations.id, { onDelete: "restrict" }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  paidThrough: timestamp("paid_through", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
