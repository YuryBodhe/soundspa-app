import { and, eq, inArray } from "drizzle-orm";
import { v2Db } from "../client";
import { locationChannelEntitlements, locationChannelGrants, locationChannelVisibility, locationServiceAccess, locations, organizations } from "../schema";
import { deleteDevicesForLocation } from "./deviceAdministration";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LocationDeletionError extends Error {
  constructor(readonly code: "not_found" | "confirmation_mismatch") {
    super(code === "not_found" ? "Location was not found." : "The typed Location name does not match the current Location name.");
    this.name = "LocationDeletionError";
  }
}

export async function deleteLocation(locationId: string, confirmationName: unknown) {
  if (!UUID.test(locationId)) throw new LocationDeletionError("not_found");

  return v2Db.transaction(async (tx) => {
    const [location] = await tx.select({ id: locations.id, name: locations.name, organizationId: locations.organizationId })
      .from(locations).where(eq(locations.id, locationId)).for("update").limit(1);
    if (!location) throw new LocationDeletionError("not_found");
    const [organization] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, location.organizationId)).limit(1);
    if (typeof confirmationName !== "string" || confirmationName.trim() !== location.name) throw new LocationDeletionError("confirmation_mismatch");

    const devices = await deleteDevicesForLocation(tx, locationId);
    const visibility = await tx.delete(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, locationId)).returning({ channelId: locationChannelVisibility.channelId });
    const grants = await tx.delete(locationChannelGrants).where(eq(locationChannelGrants.locationId, locationId)).returning({ id: locationChannelGrants.id });
    const entitlements = await tx.delete(locationChannelEntitlements).where(eq(locationChannelEntitlements.locationId, locationId)).returning({ channelId: locationChannelEntitlements.channelId });
    const serviceAccess = await tx.delete(locationServiceAccess).where(eq(locationServiceAccess.locationId, locationId)).returning({ locationId: locationServiceAccess.locationId });
    await tx.delete(locations).where(and(eq(locations.id, locationId), eq(locations.organizationId, location.organizationId)));

    return {
      locationId,
      locationName: location.name,
      organizationName: organization?.name ?? "",
      removed: { ...devices, visibility: visibility.length, grants: grants.length, entitlements: entitlements.length, serviceAccess: serviceAccess.length },
    };
  });
}
