import { 
  pgTable, 
  serial, 
  integer, 
  text, 
  boolean,
  real 
} from "drizzle-orm/pg-core";
import { tenants } from "../schema.pg";

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  // Сделали nullable для системных агентов
  tenantId: integer("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" }),
  
  name: text("name").notNull(),
  
  // Указали именно ту модель, которую ты выбрал
  model: text("model").default("nvidia/nemotron-3-super-120b-a12b:free"),
  
  kind: text("kind").notNull().default("watcher"),

  temperature: real("temperature").default(0),
  
  systemPrompt: text("system_prompt").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});