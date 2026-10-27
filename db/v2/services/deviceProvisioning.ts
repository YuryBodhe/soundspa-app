import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { CustomerDeviceAuthorizationError, customerDeviceAuthorizationFailure } from "@/lib/v2/customerDeviceAuthorization";
import { currentBrowserDeviceSecret, currentBrowserOperationHash, deriveCurrentBrowserDeviceCredential } from "@/lib/v2/currentBrowserDeviceCredential";
import { v2Db } from "../client";
import { devices, deviceActivationTokens, deviceCurrentBrowserOperations, locations, organizationMembers, organizations, users } from "../schema";
import { recordLifecycleEvent } from "./monitoringObservability";

const ACTIVATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const CURRENT_BROWSER_OPERATION_TTL_MS = 15 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export async function getDeviceActivationPreview(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = new Date();
  const [preview] = await v2Db.select({
    organizationName: organizations.name,
    locationName: locations.name,
    deviceName: devices.label,
  }).from(deviceActivationTokens)
    .innerJoin(devices, eq(devices.id, deviceActivationTokens.deviceId))
    .innerJoin(locations, eq(locations.id, devices.locationId))
    .innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(and(
      eq(deviceActivationTokens.tokenHash, tokenHash(token)), isNull(deviceActivationTokens.usedAt), gt(deviceActivationTokens.expiresAt, now),
      eq(devices.status, "active"), isNull(devices.revokedAt), isNull(devices.credentialHash),
      isNull(locations.archivedAt), isNull(organizations.archivedAt),
    ))
    .limit(1);
  return preview ?? null;
}

export class DeviceProvisioningError extends Error {
  constructor(readonly code: "validation" | "location_unavailable" | "activation_invalid" | "operation_expired" | "operation_conflict" | "configuration_unavailable") {
    super(code === "validation" ? "Enter a valid Device name and Location." : code === "location_unavailable" ? "This Location is unavailable for Device provisioning." : "This activation link is invalid, expired, already used, or unavailable.");
    this.name = "DeviceProvisioningError";
  }
}

export async function createDeviceWithActivation(input: { locationId?: unknown; name?: unknown; authorizedUserId?: string }) {
  const locationId = typeof input.locationId === "string" ? input.locationId.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!uuidPattern.test(locationId) || !name || name.length > 120) throw new DeviceProvisioningError("validation");

  const activationToken = randomBytes(32).toString("base64url");
  const hash = tokenHash(activationToken);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ACTIVATION_TOKEN_TTL_MS);
  const device = await v2Db.transaction(async (tx) => {
    const [location] = await tx.select({ id: locations.id, name: locations.name, organizationId: organizations.id, organizationName: organizations.name })
      .from(locations)
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(and(eq(locations.id, locationId), isNull(locations.archivedAt), isNull(organizations.archivedAt)))
      .limit(1);
    if (!location) throw new DeviceProvisioningError("location_unavailable");

    if (input.authorizedUserId) {
      const [user] = await tx.select({ emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
        .from(users).where(eq(users.id, input.authorizedUserId)).limit(1);
      const memberships = await tx.select({
        locationId: locations.id,
        role: organizationMembers.role,
        locationArchivedAt: locations.archivedAt,
        organizationArchivedAt: organizations.archivedAt,
      }).from(organizationMembers)
        .innerJoin(locations, eq(locations.organizationId, organizationMembers.organizationId))
        .innerJoin(organizations, eq(organizations.id, locations.organizationId))
        .where(and(eq(organizationMembers.userId, input.authorizedUserId), eq(locations.id, locationId)));
      const authorizationFailure = customerDeviceAuthorizationFailure({
        userFound: Boolean(user),
        emailVerified: Boolean(user?.emailVerifiedAt),
        userDisabled: Boolean(user?.disabledAt),
        locationId,
        memberships: memberships.map((membership) => ({
          locationId: membership.locationId,
          role: membership.role,
          locationArchived: Boolean(membership.locationArchivedAt),
          organizationArchived: Boolean(membership.organizationArchivedAt),
        })),
      });
      if (authorizationFailure) throw new DeviceProvisioningError("location_unavailable");
    }

    await tx.delete(deviceActivationTokens).where(or(isNotNull(deviceActivationTokens.usedAt), lt(deviceActivationTokens.expiresAt, createdAt)));
    const [created] = await tx.insert(devices).values({ locationId, label: name, credentialHash: null }).returning({ id: devices.id, label: devices.label, status: devices.status, createdAt: devices.createdAt });
    await tx.insert(deviceActivationTokens).values({ deviceId: created.id, tokenHash: hash, expiresAt, createdAt });
    await recordLifecycleEvent(tx, {
      eventType: "device_created",
      organizationId: location.organizationId,
      organizationName: location.organizationName,
      locationId: location.id,
      locationName: location.name,
      deviceId: created.id,
      deviceLabel: created.label,
    });
    return created;
  });
  return { device, activationToken, expiresAt };
}

/** Create and authorize the current browser in one transaction for an authenticated salon manager. */
export async function createAndActivateCustomerDevice(input: {
  authenticatedUserId: string;
  operationId?: unknown;
  locationId?: unknown;
  name?: unknown;
}) {
  const operationId = typeof input.operationId === "string" ? input.operationId.trim() : "";
  const locationId = typeof input.locationId === "string" ? input.locationId.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!uuidV4Pattern.test(operationId) || !uuidPattern.test(locationId) || !name || name.length > 120) throw new DeviceProvisioningError("validation");

  let secret: Buffer;
  try { secret = currentBrowserDeviceSecret(); }
  catch { throw new DeviceProvisioningError("configuration_unavailable"); }
  const operationHash = currentBrowserOperationHash(operationId);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CURRENT_BROWSER_OPERATION_TTL_MS);
  const result = await v2Db.transaction(async (tx) => {
    const [location] = await tx.select({
      id: locations.id, name: locations.name, organizationId: organizations.id, organizationName: organizations.name,
    }).from(locations)
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(and(eq(locations.id, locationId), isNull(locations.archivedAt), isNull(organizations.archivedAt)))
      .limit(1);
    if (!location) throw new DeviceProvisioningError("location_unavailable");

    const [user] = await tx.select({ emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
      .from(users).where(eq(users.id, input.authenticatedUserId)).limit(1);
    const memberships = await tx.select({
      locationId: locations.id,
      role: organizationMembers.role,
      locationArchivedAt: locations.archivedAt,
      organizationArchivedAt: organizations.archivedAt,
    }).from(organizationMembers)
      .innerJoin(locations, eq(locations.organizationId, organizationMembers.organizationId))
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(and(eq(organizationMembers.userId, input.authenticatedUserId), eq(locations.id, locationId)));
    const authorizationFailure = customerDeviceAuthorizationFailure({
      userFound: Boolean(user),
      emailVerified: Boolean(user?.emailVerifiedAt),
      userDisabled: Boolean(user?.disabledAt),
      locationId,
      memberships: memberships.map((membership) => ({
        locationId: membership.locationId,
        role: membership.role,
        locationArchived: Boolean(membership.locationArchivedAt),
        organizationArchived: Boolean(membership.organizationArchivedAt),
      })),
    });
    if (authorizationFailure) throw new CustomerDeviceAuthorizationError(authorizationFailure);

    const [operation] = await tx.insert(deviceCurrentBrowserOperations).values({
      operationHash, authenticatedUserId: input.authenticatedUserId, locationId, expiresAt, createdAt,
    }).onConflictDoNothing({ target: deviceCurrentBrowserOperations.operationHash })
      .returning({ operationHash: deviceCurrentBrowserOperations.operationHash });

    if (operation) {
      const candidateDeviceId = randomUUID();
      const candidateCredential = deriveCurrentBrowserDeviceCredential({
        secret, operationId, authenticatedUserId: input.authenticatedUserId, locationId, deviceId: candidateDeviceId,
      });
      const [created] = await tx.insert(devices).values({
        id: candidateDeviceId, locationId, label: name, credentialHash: tokenHash(candidateCredential), createdAt, updatedAt: createdAt,
      }).returning({ id: devices.id, label: devices.label, status: devices.status });
      await tx.update(deviceCurrentBrowserOperations).set({ deviceId: created.id })
        .where(eq(deviceCurrentBrowserOperations.operationHash, operationHash));
      await recordLifecycleEvent(tx, {
        eventType: "device_created", organizationId: location.organizationId, organizationName: location.organizationName,
        locationId: location.id, locationName: location.name, deviceId: created.id, deviceLabel: created.label,
      });
      await recordLifecycleEvent(tx, {
        eventType: "device_activated", organizationId: location.organizationId, organizationName: location.organizationName,
        locationId: location.id, locationName: location.name, deviceId: created.id, deviceLabel: created.label,
      });
      return { device: created, credential: candidateCredential };
    }

    // The permanent unique operation row serializes retries and remains after Device deletion.
    const [priorOperation] = await tx.select().from(deviceCurrentBrowserOperations)
      .where(eq(deviceCurrentBrowserOperations.operationHash, operationHash)).for("update").limit(1);
    if (!priorOperation || priorOperation.locationId !== locationId || priorOperation.authenticatedUserId !== input.authenticatedUserId) {
      throw new DeviceProvisioningError("operation_conflict");
    }
    if (priorOperation.expiresAt.getTime() <= createdAt.getTime()) {
      throw new DeviceProvisioningError("operation_expired");
    }
    if (!priorOperation.deviceId) throw new DeviceProvisioningError("operation_conflict");
    const [prior] = await tx.select({ id: devices.id, locationId: devices.locationId, label: devices.label,
      status: devices.status, credentialHash: devices.credentialHash, revokedAt: devices.revokedAt })
      .from(devices).where(eq(devices.id, priorOperation.deviceId)).limit(1);
    if (!prior || prior.locationId !== locationId || prior.status !== "active" || prior.revokedAt || !prior.credentialHash) {
      throw new DeviceProvisioningError("operation_conflict");
    }
    const priorCredential = deriveCurrentBrowserDeviceCredential({
      secret, operationId, authenticatedUserId: input.authenticatedUserId, locationId, deviceId: prior.id,
    });
    if (tokenHash(priorCredential) !== prior.credentialHash) throw new DeviceProvisioningError("configuration_unavailable");
    return { device: prior, credential: priorCredential };
  });

  return result;
}

export async function activateDevice(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DeviceProvisioningError("activation_invalid");
  const hash = tokenHash(token);
  const now = new Date();
  const credential = randomBytes(32).toString("base64url");
  const credentialHash = tokenHash(credential);

  await v2Db.transaction(async (tx) => {
    const [eligible] = await tx.select({
      tokenId: deviceActivationTokens.id,
      deviceId: devices.id,
      deviceLabel: devices.label,
      locationId: locations.id,
      locationName: locations.name,
      organizationId: organizations.id,
      organizationName: organizations.name,
    })
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

    await recordLifecycleEvent(tx, {
      eventType: "device_activated",
      organizationId: eligible.organizationId,
      organizationName: eligible.organizationName,
      locationId: eligible.locationId,
      locationName: eligible.locationName,
      deviceId: eligible.deviceId,
      deviceLabel: eligible.deviceLabel,
    });
  });
  return credential;
}
