import { pgTable, serial, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { users } from "./users";
import { organizations } from "./organizations";
import { tenants } from "./tenants"; // 👈 ДОБАВИЛИ

import { userRoleEnum } from "../enums";
import { timestamps } from "../utils";

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: serial("id").primaryKey(),

    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" }),

    // 🔥 ВРЕМЕННО ДОБАВЛЯЕМ
    tenantId: integer("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" }),

    role: userRoleEnum("role").notNull().default("manager"),

    ...timestamps,
  },
  (table) => ({
    uniqueMembership: uniqueIndex("org_member_unique").on(
      table.userId,
      table.organizationId
    ),
  })
);

export const organizationMembersRelations = relations(
  organizationMembers,
  ({ one }) => ({
    user: one(users, {
      fields: [organizationMembers.userId],
      references: [users.id],
    }),

    organization: one(organizations, {
      fields: [organizationMembers.organizationId],
      references: [organizations.id],
    }),

    // 👇 КЛЮЧЕВОЕ ДЛЯ СОВМЕСТИМОСТИ
    tenant: one(tenants, {
      fields: [organizationMembers.tenantId],
      references: [tenants.id],
    }),
  })
);