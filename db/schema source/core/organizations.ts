import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Импорты внутри Core
import { tenants } from "./tenants";
import { organizationMembers } from "./organization_members"; // ТОТ САМЫЙ ИМПОРТ

// Глобальные утилиты
import { timestamps } from "../utils";

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  
  /**
  
   * Используйте связь через organization_members с ролью 'owner'.
   */

  
  ...timestamps,
});

export const organizationsRelations = relations(organizations, ({ many }) => ({
  tenants: many(tenants),
  members: many(organizationMembers), // Теперь Drizzle видит эту связь
}));