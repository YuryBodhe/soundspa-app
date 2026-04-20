import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { tenants } from "../core/tenants";
import { subscriptionStatusEnum } from "../enums";
import { timestamps } from "../utils";

// ====================
// subscriptions table
// ====================

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),

  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),

    // ФИКС: Связь с Prodamus/Stripe
  // Сюда будем писать ID профиля подписки или ID рекуррента
              providerSubscriptionId: text("provider_subscription_id").unique(),

  status: subscriptionStatusEnum("status")
    .notNull()
    .default("trial"),

  currentPeriodEnd: timestamp("current_period_end", {
    withTimezone: true,
  }),

  trialStartedAt: timestamp("trial_started_at", {
    withTimezone: true,
  }),

  trialEndsAt: timestamp("trial_ends_at", {
    withTimezone: true,
  }),

  ...timestamps,
});

// ====================
// relations
// ====================

export const subscriptionsRelations = relations(
  subscriptions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [subscriptions.tenantId],
      references: [tenants.id],
    }),
  })
);