import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------- tenants ----------

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  // Старое поле name сохраняем для совместимости с данными
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Новое поле брендового названия для UI
  brandName: text("brand_name"),
  // Даты триала/подписки — храним как timestamptz
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
});

// ---------- users ----------

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    // В новой модели авторизации используем magic-link,
    // но поле пароля оставляем для совместимости.
    password: text("password").notNull(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => ({
    // Совмещённый уникальный индекс по email + tenantId
    uniqueEmailTenant: uniqueIndex("unique_email_tenant").on(
      table.email,
      table.tenantId,
    ),
  }),
);

// ---------- channels ----------

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  // Уникальный код/slug канала
  code: text("code").notNull().unique(),
  slug: text("slug").notNull().unique(),
  // Отображаемое имя для UI
  displayName: text("display_name").notNull(),
  // Настроение/категория (relax, dynamic, etc.)
  mood: text("mood"),
  // Тип канала: основной музыкальный или шум/ambient
  kind: text("kind").notNull().default("music"),
  // URL потока
  streamUrl: text("stream_url").notNull(),
  // Картинка превью
  image: text("image"),
  // Глобальный порядок по умолчанию
  order: integer("order").notNull().default(0),
  // Флаг "новый" канал для бейджа в UI
  isNew: boolean("is_new").notNull().default(false),
});

// ---------- tenant_channels ----------

export const tenantChannels = pgTable(
  "tenant_channels",
  {
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    // Индивидуальный порядок канала для конкретного тенанта
    order: integer("order").notNull().default(0),
  },
  (table) => ({
    pk: uniqueIndex("tenant_channels_pk").on(
      table.tenantId,
      table.channelId,
    ),
  }),
);

// ---------- invites ----------

export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  // Дата истечения инвайта
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "string",
  }),
});

// ---------- login_tokens ----------

export const loginTokens = pgTable("login_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "string",
  }).notNull(),
  usedAt: timestamp("used_at", {
    withTimezone: true,
    mode: "string",
  }),
});

// ---------- relations ----------

export const tenantRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  tenantChannels: many(tenantChannels),
}));

export const userRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
}));

export const channelRelations = relations(channels, ({ many }) => ({
  tenantChannels: many(tenantChannels),
}));

export const tenantChannelsRelations = relations(
  tenantChannels,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantChannels.tenantId],
      references: [tenants.id],
    }),
    channel: one(channels, {
      fields: [tenantChannels.channelId],
      references: [channels.id],
    }),
  }),
);
