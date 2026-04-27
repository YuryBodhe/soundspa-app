import { 
  pgTable, 
  serial, 
  integer, 
  text, 
  timestamp,
  varchar
} from "drizzle-orm/pg-core";
import { tenants } from "../schema.pg";
import { agents } from "./agents";

export const monitoringReports = pgTable("monitoring_reports", {
  id: serial("id").primaryKey(),
  
  // Привязка к клиенту/проекту
  tenantId: integer("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" }),
    
  // Привязка к конкретному агенту-исполнителю
  agentId: integer("agent_id")
    .references(() => agents.id, { onDelete: "set null" }),

  // Имя для быстрой идентификации (watcher, accountant, и т.д.)
  agentName: text("agent_name").notNull(),
  
  // Категория: technical, financial, creative
  type: varchar("type", { length: 50 }).default("technical"),
  
  // Вердикт ИИ (то, что раньше улетало в Телеграм)
  content: text("content").notNull(),
  
  // Статус: ok, warning, critical
  status: varchar("status", { length: 20 }).default("ok"),
  
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});