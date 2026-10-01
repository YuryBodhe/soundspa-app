import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { devices } from "./devices";

export const deviceActivationTokens = pgTable("device_activation_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("device_activation_tokens_token_hash_unique").on(table.tokenHash),
  index("device_activation_tokens_device_idx").on(table.deviceId),
  index("device_activation_tokens_expiry_idx").on(table.expiresAt),
]);
