import { and, asc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { customerDeviceAuthorizationFailure, provisionAuthorizedCustomerDevice, toCustomerDeviceSummary } from "@/lib/v2/customerDeviceAuthorization";
import { v2Db } from "../client";
import { deviceActivationTokens, devices, locations, organizationMembers, organizations, users } from "../schema";
import { createDeviceWithActivation } from "./deviceProvisioning";

async function authorizeLocation(authenticatedUserId: string, locationId: string): Promise<"unauthenticated" | "unverified" | "location_unavailable" | null> {
  const [user] = await v2Db.select({ emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
    .from(users).where(eq(users.id, authenticatedUserId)).limit(1);
  const memberships = await v2Db.select({
    locationId: locations.id,
    role: organizationMembers.role,
    locationArchivedAt: locations.archivedAt,
    organizationArchivedAt: organizations.archivedAt,
  }).from(organizationMembers)
    .innerJoin(locations, eq(locations.organizationId, organizationMembers.organizationId))
    .innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(and(eq(organizationMembers.userId, authenticatedUserId), eq(locations.id, locationId)));

  const failure = customerDeviceAuthorizationFailure({
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
  return failure;
}

export async function createCustomerDeviceWithActivation(input: {
  authenticatedUserId: string;
  locationId: string;
  deviceName: string;
}) {
  return provisionAuthorizedCustomerDevice(input, {
    authorize: authorizeLocation,
    createCanonical: ({ locationId, name }) => createDeviceWithActivation({
      locationId,
      name,
      authorizedUserId: input.authenticatedUserId,
    }),
  });
}

export async function listCustomerLocationsWithDevices(authenticatedUserId: string) {
  const now = new Date();
  const authorizedLocations = await v2Db.select({
    id: locations.id,
    organizationId: organizations.id,
    organizationName: organizations.name,
    name: locations.name,
    timezone: locations.timezone,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(locations, eq(locations.organizationId, organizations.id))
    .where(and(
      eq(organizationMembers.userId, authenticatedUserId),
      inArray(organizationMembers.role, ["owner", "admin"]),
      isNull(users.disabledAt),
      isNotNull(users.emailVerifiedAt),
      isNull(organizations.archivedAt),
      isNull(locations.archivedAt),
    ))
    .orderBy(asc(organizations.name), asc(locations.name), asc(locations.id));

  if (!authorizedLocations.length) return [];
  const locationIds = authorizedLocations.map((location) => location.id);
  const deviceRows = await v2Db.select({
    id: devices.id,
    locationId: devices.locationId,
    label: devices.label,
    status: devices.status,
    credentialHash: devices.credentialHash,
    revokedAt: devices.revokedAt,
    createdAt: devices.createdAt,
  }).from(devices).where(inArray(devices.locationId, locationIds))
    .orderBy(asc(devices.createdAt), asc(devices.id));
  const pendingDeviceIds = deviceRows.filter((device) => !device.credentialHash && device.status === "active" && !device.revokedAt).map((device) => device.id);
  const activeTokens = pendingDeviceIds.length ? await v2Db.select({ deviceId: deviceActivationTokens.deviceId })
    .from(deviceActivationTokens).where(and(
      inArray(deviceActivationTokens.deviceId, pendingDeviceIds),
      isNull(deviceActivationTokens.usedAt),
      gt(deviceActivationTokens.expiresAt, now),
    )) : [];
  const activeTokenDeviceIds = new Set(activeTokens.map((token) => token.deviceId));
  const devicesByLocation = new Map<string, Array<Omit<ReturnType<typeof toCustomerDeviceSummary>, "locationId">>>();

  for (const device of deviceRows) {
    const { locationId, ...summary } = toCustomerDeviceSummary({ ...device, hasUsableActivationToken: activeTokenDeviceIds.has(device.id) });
    const list = devicesByLocation.get(locationId) ?? [];
    list.push(summary);
    devicesByLocation.set(locationId, list);
  }

  return authorizedLocations.map((location) => ({
    id: location.id,
    organizationId: location.organizationId,
    organizationName: location.organizationName,
    name: location.name,
    timezone: location.timezone,
    devices: devicesByLocation.get(location.id) ?? [],
  }));
}
