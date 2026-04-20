import { pgTable, serial, text, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenants } from "./tenants";
import { organizationMembers } from "./organization_members";
import { timestamps } from "../utils";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),

    email: text("email").notNull(),

    password: text("password"),

    // 🔥 ДЕЛАЕМ NOT NULL
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    ...timestamps,
  },
  (table) => ({
    uniqueEmailTenant: uniqueIndex("unique_email_tenant").on(
      table.email,
      table.tenantId
    ),
  })
);

export const usersRelations = relations(users, ({ many, one }) => ({
  memberships: many(organizationMembers),

  // ✅ временно оставляем
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
}));