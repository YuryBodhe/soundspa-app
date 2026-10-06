import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid, primaryKey, index } from "drizzle-orm/pg-core";
import { channels } from "./channels";

export const channelTranslations = pgTable("channel_translations", {
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.locale] }),
  index("channel_translations_locale_idx").on(table.locale),
  check("channel_translations_locale_format", sql`${table.locale} ~ '^[a-z]{2,8}(-[a-z]{2,8})?$'`),
  check("channel_translations_title_nonempty", sql`length(btrim(${table.title})) > 0`),
]);
