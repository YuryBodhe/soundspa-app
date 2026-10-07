export type CustomerDeviceMembership = {
  locationId: string;
  role: string;
  locationArchived: boolean;
  organizationArchived: boolean;
};

export type CustomerDeviceAuthorizationInput = {
  userFound: boolean;
  emailVerified: boolean;
  userDisabled: boolean;
  memberships: CustomerDeviceMembership[];
  locationId: string;
};

export type CustomerDeviceAuthorizationFailure = "unauthenticated" | "unverified" | "location_unavailable";

export class CustomerDeviceAuthorizationError extends Error {
  constructor(readonly code: CustomerDeviceAuthorizationFailure) {
    super(code);
    this.name = "CustomerDeviceAuthorizationError";
  }
}

export function customerDeviceAuthorizationFailure(input: CustomerDeviceAuthorizationInput): CustomerDeviceAuthorizationFailure | null {
  if (!input.userFound || input.userDisabled) return "unauthenticated";
  if (!input.emailVerified) return "unverified";
  const authorized = input.memberships.some((membership) => membership.locationId === input.locationId
    && (membership.role === "owner" || membership.role === "admin")
    && !membership.locationArchived && !membership.organizationArchived);
  return authorized ? null : "location_unavailable";
}

export async function provisionAuthorizedCustomerDevice<T>(input: {
  authenticatedUserId: string;
  locationId: string;
  deviceName: string;
}, dependencies: {
  authorize: (userId: string, locationId: string) => Promise<CustomerDeviceAuthorizationFailure | null>;
  createCanonical: (input: { locationId: string; name: string }) => Promise<T>;
}): Promise<T> {
  const failure = await dependencies.authorize(input.authenticatedUserId, input.locationId);
  if (failure) throw new CustomerDeviceAuthorizationError(failure);
  return dependencies.createCanonical({ locationId: input.locationId, name: input.deviceName });
}

export function toCustomerDeviceSummary(input: {
  id: string;
  locationId: string;
  label: string | null;
  status: "active" | "revoked";
  credentialHash: string | null;
  revokedAt: Date | null;
  hasUsableActivationToken: boolean;
  createdAt: Date;
}) {
  const revoked = input.status === "revoked" || Boolean(input.revokedAt);
  return {
    locationId: input.locationId,
    label: input.label,
    state: revoked ? "revoked" as const : "active" as const,
    activationState: revoked ? "revoked" as const : input.credentialHash ? "activated" as const : input.hasUsableActivationToken ? "awaiting" as const : "expired" as const,
    createdAt: input.createdAt.toISOString(),
  };
}
