import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Импорты из этой же папки (Core)
import { organizations } from "./organizations";

// Глобальные правила
import { tenantStatusEnum } from "../enums";
import { timestamps } from "../utils";


export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),

  // 🔥 временно nullable
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" }),

  name: text("name").notNull(),

  // 🔥 оставляем как было
  slug: text("slug").notNull().unique(),

  brandName: text("brand_name"),

  timezone: text("timezone").default("UTC").notNull(),

  status: tenantStatusEnum("status").default("trial").notNull(),

  activeSlots: integer("active_slots").default(1).notNull(),

  trialStartedAt: timestamp("trial_started_at", {
    withTimezone: true,
    mode: "string",
  }),
  trialEndsAt: timestamp("trial_ends_at", {
    withTimezone: true,
    mode: "string",
  }),
  paidTill: timestamp("paid_till", {
    withTimezone: true,
    mode: "string",
  }),

  ...timestamps,
  },
  (table) => ({
    // 4. Композитный индекс: slug уникален только внутри одной организации
    orgSlugIdx: uniqueIndex("org_slug_idx").on(table.organizationId, table.slug),
  })
);

// В блоке tenantsRelations добавь many-связи:
export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tenants.organizationId],
    references: [organizations.id],
  }),
}));