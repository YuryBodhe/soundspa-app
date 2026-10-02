import { asc, eq, sql } from "drizzle-orm";
import { v2Db } from "../client";
import { devices, locations, organizations } from "../schema";

export async function getOrganization(id: string) {
  const [organization] = await v2Db.select().from(organizations).where(eq(organizations.id, id));
  return organization ?? null;
}

export async function listOrganizationsWithLocations() {
  const [organizationRows, locationRows, deviceCounts] = await Promise.all([
    v2Db.select().from(organizations).orderBy(asc(organizations.name), asc(organizations.id)),
    v2Db.select().from(locations).orderBy(asc(locations.organizationId), asc(locations.name), asc(locations.id)),
    v2Db.select({
      organizationId: locations.organizationId,
      deviceCount: sql<number>`count(${devices.id})::int`,
    })
      .from(devices)
      .innerJoin(locations, eq(locations.id, devices.locationId))
      .groupBy(locations.organizationId),
  ]);
  const byOrganization = new Map<string, typeof locationRows>();
  const devicesByOrganization = new Map(deviceCounts.map(({ organizationId, deviceCount }) => [organizationId, deviceCount]));
  for (const location of locationRows) {
    const current = byOrganization.get(location.organizationId) ?? [];
    current.push(location);
    byOrganization.set(location.organizationId, current);
  }
  return organizationRows.map((organization) => ({
    organization,
    locations: byOrganization.get(organization.id) ?? [],
    deviceCount: devicesByOrganization.get(organization.id) ?? 0,
  }));
}
