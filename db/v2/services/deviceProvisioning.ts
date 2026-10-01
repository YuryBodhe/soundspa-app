import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { v2Db } from "../client";
import { devices, deviceActivationTokens, locations, organizations } from "../schema";

const ACTIVATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export class DeviceProvisioningError extends Error {
  constructor(readonly code: "validation" | "location_unavailable" | "activation_invalid") {
    super(code === "validation" ? "Enter a valid Device name and Location." : code === "location_unavailable" ? "This Location is unavailable for Device provisioning." : "This activation link is invalid, expired, already used, or unavailable.");
    this.name = "DeviceProvisioningError";
  }
}

export async function createDeviceWithActivation(input: { locationId?: unknown; name?: unknown }) {
  const locationId = typeof input.locationId === "string" ? input.locationId.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!uuidPattern.test(locationId) || !name || name.length > 120) throw new DeviceProvisioningError("validation");

  const activationToken = randomBytes(32).toString("base64url");
  const hash = tokenHash(activationToken);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ACTIVATION_TOKEN_TTL_MS);
  const device = await v2Db.transaction(async (tx) => {
    const [location] = await tx.select({ id: locations.id })
      .from(locations)
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(and(eq(locations.id, locationId), isNull(locations.archivedAt), isNull(organizations.archivedAt)))
      .limit(1);
    if (!location) throw new DeviceProvisioningError("location_unavailable");

    await tx.delete(deviceActivationTokens).where(or(isNotNull(deviceActivationTokens.usedAt), lt(deviceActivationTokens.expiresAt, createdAt)));
    const [created] = await tx.insert(devices).values({ locationId, label: name, credentialHash: null }).returning({ id: devices.id, label: devices.label, status: devices.status, createdAt: devices.createdAt });
    await tx.insert(deviceActivationTokens).values({ deviceId: created.id, tokenHash: hash, expiresAt, createdAt });
    return created;
  });
  return { device, activationToken, expiresAt };
}

export async function activateDevice(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DeviceProvisioningError("activation_invalid");
  const hash = tokenHash(token);
  const now = new Date();
  const credential = randomBytes(32).toString("base64url");
  const credentialHash = tokenHash(credential);

  await v2Db.transaction(async (tx) => {
    const [eligible] = await tx.select({ tokenId: deviceActivationTokens.id, deviceId: devices.id })
      .from(deviceActivationTokens)
      .innerJoin(devices, eq(devices.id, deviceActivationTokens.deviceId))
      .innerJoin(locations, eq(locations.id, devices.locationId))
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(and(
        eq(deviceActivationTokens.tokenHash, hash), isNull(deviceActivationTokens.usedAt), gt(deviceActivationTokens.expiresAt, now),
        eq(devices.status, "active"), isNull(devices.revokedAt), isNull(devices.credentialHash),
        isNull(locations.archivedAt), isNull(organizations.archivedAt),
      ))
      .for("update")
      .limit(1);
    if (!eligible) throw new DeviceProvisioningError("activation_invalid");

    const [updatedDevice] = await tx.update(devices).set({ credentialHash, updatedAt: now })
      .where(and(eq(devices.id, eligible.deviceId), isNull(devices.credentialHash), eq(devices.status, "active"), isNull(devices.revokedAt)))
      .returning({ id: devices.id });
    if (!updatedDevice) throw new DeviceProvisioningError("activation_invalid");

    const [consumed] = await tx.update(deviceActivationTokens).set({ usedAt: now })
      .where(and(eq(deviceActivationTokens.id, eligible.tokenId), isNull(deviceActivationTokens.usedAt), gt(deviceActivationTokens.expiresAt, now)))
      .returning({ id: deviceActivationTokens.id });
    if (!consumed) throw new DeviceProvisioningError("activation_invalid");
  });
  return credential;
}
