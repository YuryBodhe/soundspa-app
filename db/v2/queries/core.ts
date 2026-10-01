import { asc, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { locations, organizations } from "../schema";

export async function getOrganization(id: string) {
  const [organization] = await v2Db.select().from(organizations).where(eq(organizations.id, id));
  return organization ?? null;
}

export async function listOrganizationsWithLocations() {
  const [organizationRows, locationRows] = await Promise.all([
    v2Db.select().from(organizations).orderBy(asc(organizations.name), asc(organizations.id)),
    v2Db.select().from(locations).orderBy(asc(locations.organizationId), asc(locations.name), asc(locations.id)),
  ]);
  const byOrganization = new Map<string, typeof locationRows>();
  for (const location of locationRows) {
    const current = byOrganization.get(location.organizationId) ?? [];
    current.push(location);
    byOrganization.set(location.organizationId, current);
  }
  return organizationRows.map((organization) => ({
    organization,
    locations: byOrganization.get(organization.id) ?? [],
  }));
}
