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

// ---------- TENANTS (Салоны) ----------

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  // Системное имя (например, для админки)
  name: text("name").notNull(),
  // Уникальный адрес для входа в плеер (soundspa.com/slug)
  slug: text("slug").notNull().unique(),
  // Красивое название для отображения внутри плеера
  brandName: text("brand_name"),
  
  // Даты триала
  trialStartedAt: timestamp("trial_started_at", {
    withTimezone: true,
    mode: "string",
  }),
  trialEndsAt: timestamp("trial_ends_at", {
    withTimezone: true,
    mode: "string",
  }),
  
  // КРИТИЧЕСКОЕ ПОЛЕ: До какого числа оплачен сервис.
  // На основе этого поля мы считаем "Осталось дней" в админке.
  paidTill: timestamp("paid_till", {
    withTimezone: true,
    mode: "string",
  }),

  usersCount: integer("users_count").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------- USERS (Пользователи) ----------

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    // Пароль оставляем для совместимости, хотя переходим на Magic Links
    password: text("password").notNull(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("user"),
  },
  (table) => ({
    uniqueEmailTenant: uniqueIndex("unique_email_tenant").on(
      table.email,
      table.tenantId,
    ),
  }),
);

// ---------- CHANNELS (Музыкальные каналы) ----------

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // Короткий код (jazz, relax)
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  mood: text("mood"),
  kind: text("kind").notNull().default("music"), // music или ambient
  streamUrl: text("stream_url").notNull(),
  image: text("image"),
  order: integer("order").notNull().default(0),
  isNew: boolean("is_new").notNull().default(false),
});

// ---------- TENANT_CHANNELS (Доступные каналы для салона) ----------

export const tenantChannels = pgTable(
  "tenant_channels",
  {
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    order: integer("order").notNull().default(0),
  },
  (table) => ({
    pk: uniqueIndex("tenant_channels_pk").on(
      table.tenantId,
      table.channelId,
    ),
  }),
);

// ---------- PAYMENTS (Платежи Prodamus) ----------

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  
  amount: text("amount"), // Сумма текстом (как приходит от платежки)
  status: text("status").default("pending"), // pending, success, failed
  
  // Сколько дней подписки было куплено (30, 365 и т.д.)
  // Это поле поможет в аналитике видеть, кто берет "оптом"
  periodDays: integer("period_days").default(30),
  
  prodamusId: text("prodamus_id"), // Внешний ID транзакции
  orderId: text("order_id"),       // Внутренний ID заказа
  
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "string",
  }).defaultNow(),
});

// ---------- АВТОРИЗАЦИЯ (Инвайты и Токены) ----------

export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),

  tenantId: integer("tenant_id").references(() => tenants.id, {
    onDelete: "set null",
  }),

  issuedTo: text("issued_to"),

  createdByUserId: integer("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  usedByTenantId: integer("used_by_tenant_id").references(() => tenants.id, {
    onDelete: "set null",
  }),
  usedByUserId: integer("used_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  baseLabel: text("base_label"),

  rotationIntervalMonths: integer("rotation_interval_months"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const loginTokens = pgTable("login_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
});

// ---------- RELATIONS (Связи между таблицами) ----------

export const tenantRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  tenantChannels: many(tenantChannels),
  payments: many(payments),
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

export const tenantChannelsRelations = relations(tenantChannels, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantChannels.tenantId],
    references: [tenants.id],
  }),
  channel: one(channels, {
    fields: [tenantChannels.channelId],
    references: [channels.id],
  }),
}));

export const paymentRelations = relations(payments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [payments.tenantId],
    references: [tenants.id],
  }),
}));