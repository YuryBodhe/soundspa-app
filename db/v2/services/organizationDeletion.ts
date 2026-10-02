import { and, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { organizationMembers, locations, organizations } from "../schema";
import { deleteDevicesForLocation } from "./deviceAdministration";
import { deleteLocationOwnedData } from "./locationOwnedData";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OrganizationDeletionError extends Error {
  constructor(readonly code: "not_found" | "confirmation_mismatch") {
    super(code === "not_found" ? "Organization was not found." : "The typed Organization name does not match the current Organization name.");
    this.name = "OrganizationDeletionError";
  }
}

export async function deleteOrganization(organizationId: string, confirmationName: unknown) {
  if (!UUID.test(organizationId)) throw new OrganizationDeletionError("not_found");

  return v2Db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id, name: organizations.name })
      .from(organizations).where(eq(organizations.id, organizationId)).for("update").limit(1);
    if (!organization) throw new OrganizationDeletionError("not_found");
    if (typeof confirmationName !== "string" || confirmationName !== organization.name) throw new OrganizationDeletionError("confirmation_mismatch");

    const ownedLocations = await tx.select({ id: locations.id })
      .from(locations).where(eq(locations.organizationId, organizationId)).orderBy(locations.id).for("update");

    const removed = {
      locations: 0,
      devices: 0,
      activationTokens: 0,
      currentStates: 0,
      events: 0,
      visibility: 0,
      grants: 0,
      entitlements: 0,
      serviceAccess: 0,
      memberships: 0,
    };

    for (const location of ownedLocations) {
      const devices = await deleteDevicesForLocation(tx, location.id);
      const locationData = await deleteLocationOwnedData(tx, location.id);
      removed.devices += devices.devices;
      removed.activationTokens += devices.activationTokens;
      removed.currentStates += devices.currentStates;
      removed.events += devices.events;
      removed.visibility += locationData.visibility;
      removed.grants += locationData.grants;
      removed.entitlements += locationData.entitlements;
      removed.serviceAccess += locationData.serviceAccess;
      await tx.delete(locations).where(and(eq(locations.id, location.id), eq(locations.organizationId, organizationId)));
      removed.locations++;
    }

    const memberships = await tx.delete(organizationMembers).where(eq(organizationMembers.organizationId, organizationId)).returning({ userId: organizationMembers.userId });
    await tx.delete(organizations).where(eq(organizations.id, organizationId));
    removed.memberships = memberships.length;

    return { organizationId, organizationName: organization.name, removed };
  });
}
