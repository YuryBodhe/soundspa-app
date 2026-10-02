import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import { deviceActivationTokens, deviceCurrentState, deviceEvents, devices, locations, organizations } from "../schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;

export class DeviceAdministrationError extends Error {
  constructor(readonly code: "not_found" | "not_pending" | "location_unavailable") {
    super(code === "not_found" ? "Device was not found." : code === "not_pending" ? "Only a pending, non-revoked Device can receive a new activation link." : "The Location or Organization is archived; activation cannot be reissued.");
    this.name = "DeviceAdministrationError";
  }
}

export async function reissueDeviceActivation(deviceId: string) {
  if (!UUID.test(deviceId)) throw new DeviceAdministrationError("not_found");
  const activationToken = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ACTIVATION_TTL_MS);

  const device = await v2Db.transaction(async (tx) => {
    const [current] = await tx.select({
      id: devices.id,
      credentialHash: devices.credentialHash,
      status: devices.status,
      revokedAt: devices.revokedAt,
      locationArchivedAt: locations.archivedAt,
      organizationArchivedAt: organizations.archivedAt,
    }).from(devices)
      .innerJoin(locations, eq(locations.id, devices.locationId))
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(eq(devices.id, deviceId))
      .for("update")
      .limit(1);
    if (!current) throw new DeviceAdministrationError("not_found");
    if (current.status !== "active" || current.revokedAt || current.credentialHash) throw new DeviceAdministrationError("not_pending");
    if (current.locationArchivedAt || current.organizationArchivedAt) throw new DeviceAdministrationError("location_unavailable");

    await tx.delete(deviceActivationTokens).where(and(eq(deviceActivationTokens.deviceId, deviceId), isNull(deviceActivationTokens.usedAt)));
    await tx.insert(deviceActivationTokens).values({ deviceId, tokenHash: tokenHash(activationToken), expiresAt, createdAt });
    return { id: current.id };
  });

  return { device, activationToken, expiresAt };
}

export async function deleteDevice(deviceId: string) {
  if (!UUID.test(deviceId)) throw new DeviceAdministrationError("not_found");
  return v2Db.transaction(async (tx) => {
    const [device] = await tx.select({ id: devices.id, locationId: devices.locationId, label: devices.label })
      .from(devices).where(eq(devices.id, deviceId)).for("update").limit(1);
    if (!device) throw new DeviceAdministrationError("not_found");

    const activationTokens = await tx.delete(deviceActivationTokens).where(eq(deviceActivationTokens.deviceId, deviceId)).returning({ id: deviceActivationTokens.id });
    const currentStates = await tx.delete(deviceCurrentState).where(eq(deviceCurrentState.deviceId, deviceId)).returning({ deviceId: deviceCurrentState.deviceId });
    const events = await tx.delete(deviceEvents).where(eq(deviceEvents.deviceId, deviceId)).returning({ id: deviceEvents.id });
    await tx.delete(devices).where(eq(devices.id, deviceId));
    return { ...device, removed: { activationTokens: activationTokens.length, currentStates: currentStates.length, events: events.length } };
  });
}

export async function deleteDevicesForLocation(tx: Parameters<Parameters<typeof v2Db.transaction>[0]>[0], locationId: string) {
  const deviceRows = await tx.select({ id: devices.id }).from(devices).where(eq(devices.locationId, locationId)).for("update");
  const ids = deviceRows.map(({ id }) => id);
  if (!ids.length) return { devices: 0, activationTokens: 0, currentStates: 0, events: 0 };

  const activationTokens = await tx.delete(deviceActivationTokens).where(inArray(deviceActivationTokens.deviceId, ids)).returning({ id: deviceActivationTokens.id });
  const currentStates = await tx.delete(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, ids)).returning({ deviceId: deviceCurrentState.deviceId });
  const events = await tx.delete(deviceEvents).where(inArray(deviceEvents.deviceId, ids)).returning({ id: deviceEvents.id });
  await tx.delete(devices).where(inArray(devices.id, ids));
  return { devices: ids.length, activationTokens: activationTokens.length, currentStates: currentStates.length, events: events.length };
}
