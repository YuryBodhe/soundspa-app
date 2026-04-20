import {
  pgTable,
  serial,
  integer,
  timestamp,
  jsonb,
  text,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { tenants } from "../core/tenants";
import { paymentStatusEnum } from "../enums";

// ====================
// payments table
// ====================

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),

  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),

  // В таблице payments
             providerEventId: text("provider_event_id").notNull().unique(), 
// Сюда пишем payment_id от Prodamus или id сессии от Stripe  

  status: paymentStatusEnum("status").notNull(),

  amount: integer("amount"), // можно потом decimal

  payload: jsonb("payload"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ====================
// relations
// ====================

export const paymentsRelations = relations(payments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [payments.tenantId],
    references: [tenants.id],
  }),
}));