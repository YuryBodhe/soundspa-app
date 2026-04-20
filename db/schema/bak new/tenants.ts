import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { payments } from "./payments";
import { tenantChannels } from "./channels";

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  brandName: text("brand_name"),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true, mode: "string" }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: "string" }),
  paidTill: timestamp("paid_till", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const tenantRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  payments: many(payments),
  tenantChannels: many(tenantChannels),
}));