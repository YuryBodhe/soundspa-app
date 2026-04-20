import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { kindEnum } from "../enums";
import { timestamps } from "../utils";
import { tenantChannels } from "./tenant_channels";

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  
  // Уникальные идентификаторы
  code: text("code").notNull().unique(), // Например: 'lofi-relax'
  slug: text("slug").notNull().unique(), // Для URL
  
  displayName: text("display_name").notNull(),
  mood: text("mood"), // Настроение (chill, energetic, etc.)
  
  // Тип контента из нашего enums.ts
  kind: kindEnum("kind").default("music").notNull(),
  
  streamUrl: text("stream_url").notNull(),
  image: text("image"), // Обложка канала
  
  order: integer("order").notNull().default(0),
  isNew: boolean("is_new").notNull().default(false),
  
  ...timestamps,
});

// Связи: Один канал может быть во многих салонах
export const channelsRelations = relations(channels, ({ many }) => ({
  tenantChannels: many(tenantChannels),
}));