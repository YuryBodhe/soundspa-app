import { 
  sqliteTable, 
  integer, 
  text, 
  unique 
} from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const tenants = sqliteTable('tenants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Старое поле name сохраняем для совместимости с данными
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  // Новое поле брендового названия для UI
  brandName: text('brand_name'),
  // Дата начала триала (ISO-строка)
  trialStartedAt: text('trial_started_at'),
  // Дата окончания триала (ISO-строка)
  trialEndsAt: text('trial_ends_at'),
  // Дата окончания подписки (ISO-строка)
  paidTill: text('paid_till'),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').unique().notNull(),
  // Старое поле пароля сохраняем для обратной совместимости,
  // но в новой модели авторизации используем magic link.
  password: text('password').notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
}, (table) => ({
  uniqueEmailTenant: unique('unique_email_tenant').on(table.email, table.tenantId),
}));

export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Уникальный код/slug канала
  code: text('code').notNull().unique(),
  slug: text('slug').notNull().unique(),
  // Отображаемое имя для UI
  displayName: text('display_name').notNull(),
  // Настроение/категория (relax, dynamic, etc.)
  mood: text('mood'),
  // Тип канала: основной музыкальный или шум/ambient
  kind: text('kind').notNull().default('music'),
  // URL потока
  streamUrl: text('stream_url').notNull(),
  // Картинка превью
  image: text('image'),
  // Глобальный порядок по умолчанию
  order: integer('order').notNull().default(0),
  // Флаг "новый" канал для бейджа в UI
  isNew: integer('is_new', { mode: 'boolean' }).notNull().default(false),
});

export const tenantChannels = sqliteTable('tenant_channels', {
  tenantId: integer('tenant_id').references(() => tenants.id).notNull(),
  channelId: integer('channel_id').references(() => channels.id).notNull(),
  // Индивидуальный порядок канала для конкретного тенанта
  order: integer('order').notNull().default(0),
}, (table) => ({
  pk: unique().on(table.tenantId, table.channelId),
}));

export const tenantRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  tenantChannels: many(tenantChannels)
}));

export const userRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id]
  })
}));

export const channelRelations = relations(channels, ({ many }) => ({
  tenantChannels: many(tenantChannels)
}));

export const tenantChannelsRelations = relations(tenantChannels, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantChannels.tenantId],
    references: [tenants.id]
  }),
  channel: one(channels, {
    fields: [tenantChannels.channelId],
    references: [channels.id]
  })
}));

// Инвайты для контролируемой регистрации
export const invites = sqliteTable('invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').unique().notNull(),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: text('expires_at'),
});

// Токены для magic link логина
export const loginTokens = sqliteTable('login_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').unique().notNull(),
  userId: integer('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
});
