import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import { devices, locations, organizations } from "../schema";

export async function authenticateDeviceCredential(credential: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  const credentialHash = createHash("sha256").update(credential, "utf8").digest("hex");
  const [context] = await db.select({ deviceId: devices.id, locationId: locations.id, locationName: locations.name, organizationId: organizations.id })
    .from(devices)
    .innerJoin(locations, eq(locations.id, devices.locationId))
    .innerJoin(organizations, and(eq(organizations.id, locations.organizationId), isNull(organizations.archivedAt)))
    .where(and(eq(devices.credentialHash, credentialHash), eq(devices.status, "active"), isNull(devices.revokedAt), isNull(locations.archivedAt)));
  return context ?? null;
}

export async function listDevicesForLocation(locationId: string) {
  const rows = await v2Db.select({
    id: devices.id,
    label: devices.label,
    status: devices.status,
    credentialHash: devices.credentialHash,
    revokedAt: devices.revokedAt,
    createdAt: devices.createdAt,
  }).from(devices).where(eq(devices.locationId, locationId)).orderBy(asc(devices.createdAt), asc(devices.id));
  return rows.map(({ credentialHash, revokedAt, ...device }) => ({
    ...device,
    activationState: revokedAt || device.status === "revoked" ? "revoked" as const : credentialHash ? "activated" as const : "pending" as const,
  }));
}
