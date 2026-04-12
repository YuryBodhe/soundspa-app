import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

// WARNING: This file is only used by drizzle-kit for migrations.
// It should mirror db/schema.ts shape closely for the tables that need SQL.

export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  mood: text('mood'),
  kind: text('kind').notNull().default('music'),
  streamUrl: text('stream_url').notNull(),
  image: text('image'),
  order: integer('order').notNull().default(0),
  isNew: integer('is_new', { mode: 'boolean' }).notNull().default(false),
});
