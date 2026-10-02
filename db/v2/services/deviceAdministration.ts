import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import { deviceActivationTokens, deviceCurrentState, deviceEvents, devices, locations, organizations } from "../schema";
import { recordLifecycleEvent } from "./monitoringObservability";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;

export class DeviceAdministrationError extends Error {
  constructor(readonly code: "not_found" | "not_pending" | "not_activated" | "location_unavailable") {
    super(code === "not_found" ? "Device was not found." : code === "not_pending" ? "Only a pending, non-revoked Device can receive a new activation link." : code === "not_activated" ? "Only an activated, non-revoked Device can have its access reset." : "The Location or Organization is archived; Device access cannot be changed.");
    this.name = "DeviceAdministrationError";
  }
}

export async function resetActivatedDeviceAccess(deviceId: string) {
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
    if (current.status !== "active" || current.revokedAt || !current.credentialHash) throw new DeviceAdministrationError("not_activated");
    if (current.locationArchivedAt || current.organizationArchivedAt) throw new DeviceAdministrationError("location_unavailable");

    const [invalidated] = await tx.update(devices)
      .set({ credentialHash: null, updatedAt: createdAt })
      .where(and(eq(devices.id, deviceId), eq(devices.credentialHash, current.credentialHash), eq(devices.status, "active"), isNull(devices.revokedAt)))
      .returning({ id: devices.id });
    if (!invalidated) throw new DeviceAdministrationError("not_activated");

    // Keep only the fresh one-time link; the Device identity and history remain untouched.
    await tx.delete(deviceActivationTokens).where(eq(deviceActivationTokens.deviceId, deviceId));
    await tx.insert(deviceActivationTokens).values({ deviceId, tokenHash: tokenHash(activationToken), expiresAt, createdAt });
    return { id: current.id };
  });

  return { device, activationToken, expiresAt };
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
    const [device] = await tx.select({
      id: devices.id,
      locationId: devices.locationId,
      label: devices.label,
      locationName: locations.name,
      organizationId: organizations.id,
      organizationName: organizations.name,
    })
      .from(devices)
      .innerJoin(locations, eq(locations.id, devices.locationId))
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(eq(devices.id, deviceId)).for("update").limit(1);
    if (!device) throw new DeviceAdministrationError("not_found");

    await recordLifecycleEvent(tx, {
      eventType: "device_deleted",
      organizationId: device.organizationId,
      organizationName: device.organizationName,
      locationId: device.locationId,
      locationName: device.locationName,
      deviceId: device.id,
      deviceLabel: device.label,
    });
    const activationTokens = await tx.delete(deviceActivationTokens).where(eq(deviceActivationTokens.deviceId, deviceId)).returning({ id: deviceActivationTokens.id });
    const currentStates = await tx.delete(deviceCurrentState).where(eq(deviceCurrentState.deviceId, deviceId)).returning({ deviceId: deviceCurrentState.deviceId });
    const events = await tx.delete(deviceEvents).where(eq(deviceEvents.deviceId, deviceId)).returning({ id: deviceEvents.id });
    await tx.delete(devices).where(eq(devices.id, deviceId));
    return { ...device, removed: { activationTokens: activationTokens.length, currentStates: currentStates.length, events: events.length } };
  });
}

export async function deleteDevicesForLocation(tx: Parameters<Parameters<typeof v2Db.transaction>[0]>[0], locationId: string) {
  const deviceRows = await tx.select({
    id: devices.id,
    label: devices.label,
    locationId: locations.id,
    locationName: locations.name,
    organizationId: organizations.id,
    organizationName: organizations.name,
  }).from(devices)
    .innerJoin(locations, eq(locations.id, devices.locationId))
    .innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(eq(devices.locationId, locationId)).for("update");
  const ids = deviceRows.map(({ id }) => id);
  if (!ids.length) return { devices: 0, activationTokens: 0, currentStates: 0, events: 0 };

  for (const device of deviceRows) {
    await recordLifecycleEvent(tx, {
      eventType: "device_deleted",
      organizationId: device.organizationId,
      organizationName: device.organizationName,
      locationId: device.locationId,
      locationName: device.locationName,
      deviceId: device.id,
      deviceLabel: device.label,
    });
  }

  const activationTokens = await tx.delete(deviceActivationTokens).where(inArray(deviceActivationTokens.deviceId, ids)).returning({ id: deviceActivationTokens.id });
  const currentStates = await tx.delete(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, ids)).returning({ deviceId: deviceCurrentState.deviceId });
  const events = await tx.delete(deviceEvents).where(inArray(deviceEvents.deviceId, ids)).returning({ id: deviceEvents.id });
  await tx.delete(devices).where(inArray(devices.id, ids));
  return { devices: ids.length, activationTokens: activationTokens.length, currentStates: currentStates.length, events: events.length };
}
