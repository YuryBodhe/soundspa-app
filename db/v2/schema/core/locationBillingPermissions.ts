import { foreignKey, index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { locations } from "./locations";
import { organizationMembers } from "./organizationMembers";
import { users } from "./users";

/** Explicit billing delegation for one manager and one Location. */
export const locationBillingPermissions = pgTable("location_billing_permissions", {
  locationId: uuid("location_id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id").notNull(),
  grantedByUserId: uuid("granted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.locationId, table.userId] }),
  foreignKey({
    name: "location_billing_permissions_location_org_fk",
    columns: [table.locationId, table.organizationId],
    foreignColumns: [locations.id, locations.organizationId],
  }).onDelete("cascade"),
  foreignKey({
    name: "location_billing_permissions_member_fk",
    columns: [table.organizationId, table.userId],
    foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
  }).onDelete("cascade"),
  index("location_billing_permissions_user_idx").on(table.userId, table.organizationId),
]);
