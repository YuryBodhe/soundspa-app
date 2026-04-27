import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// 1. Импортируем все схемы (как у тебя и было)
import * as schemaPg from "./schema.pg";
import * as monitoring from "./schema/monitoring";
import * as agents from "./schema/agents";
import * as actions from "./schema/actions";
import * as monitoringReports from "./schema/monitoring_reports";

// Собираем общую схему для Drizzle
const fullSchema = { 
  ...schemaPg, 
  ...monitoring, 
  ...agents, 
  ...actions, 
  ...monitoringReports
};

// 2. Настраиваем пул соединений (используем твой DATABASE_URL из .env)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 3. КРИТИЧЕСКИ ВАЖНО: Экспортируем переменную db
export const db = drizzle(pool, { schema: fullSchema });

// 4. Твои старые экспорты типов/схем (чтобы ничего не сломалось в других местах)
export * from "./schema.pg";
export * from "./schema/monitoring";
export * from "./schema/agents";
export * from "./schema/actions";
export * from "./schema/monitoring_reports";