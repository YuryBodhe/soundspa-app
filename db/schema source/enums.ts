import { pgEnum } from "drizzle-orm/pg-core";

// --- CORE ---(Организации, Салоны, Люди)
export const tenantStatusEnum = pgEnum("tenant_status", [
  "trial",
  "active",
  "inactive",
  "blocked"
]);

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "admin",
  "manager"
]);

// --- BILLING ---(Подписки, Деньги)
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trial",
  "active",
  "past_due",
  "canceled",
  "expired"
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded"
]);

// --- PRODUCT ---(Медиа, Мониторинг)
export const kindEnum = pgEnum("kind", [
  "music",
  "ambient",
  "voice" // добавим на будущее, не помешает
]);

// --- AGENTS ---(Агенты)
export const agentRoleEnum = pgEnum("agent_role", [
  "overseer",
  "support",
  "growth"
]);