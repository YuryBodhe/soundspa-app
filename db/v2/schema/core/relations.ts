import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { organizationMembers } from "./organizationMembers";
import { locations } from "./locations";

export const organizationRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  locations: many(locations),
}));
export const userRelations = relations(users, ({ many }) => ({
  memberships: many(organizationMembers),
}));
export const organizationMemberRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, { fields: [organizationMembers.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [organizationMembers.userId], references: [users.id] }),
}));
export const locationRelations = relations(locations, ({ one }) => ({
  organization: one(organizations, { fields: [locations.organizationId], references: [organizations.id] }),
}));
