export const DEFAULT_CUSTOMER_LOCATION_LIMIT = 20;

export type CustomerLocationInput = { name: string; timezone: string };
export type CustomerLocationCreationFailure = "unauthenticated" | "unverified" | "owner_required" | "organization_unavailable" | "duplicate_name" | "location_limit" | "validation" | "slug_conflict" | "configuration";

export class CustomerLocationError extends Error {
  constructor(readonly code: CustomerLocationCreationFailure, message: string) {
    super(message);
    this.name = "CustomerLocationError";
  }
}

export function customerLocationLimit(configured = process.env.V2_MAX_LOCATIONS_PER_ORGANIZATION): number {
  if (configured === undefined || configured.trim() === "") return DEFAULT_CUSTOMER_LOCATION_LIMIT;
  if (!/^[1-9]\d*$/.test(configured)) throw new CustomerLocationError("configuration", "Location limit configuration is invalid.");
  const limit = Number(configured);
  if (!Number.isSafeInteger(limit) || limit > DEFAULT_CUSTOMER_LOCATION_LIMIT) {
    throw new CustomerLocationError("configuration", "Location limit configuration must be between 1 and 20.");
  }
  return limit;
}

export function validateCustomerLocationInput(value: unknown): CustomerLocationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomerLocationError("validation", "Location details are required.");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || typeof input.timezone !== "string") {
    throw new CustomerLocationError("validation", "Location name and time zone are required.");
  }
  const name = input.name.trim();
  const timezone = input.timezone.trim();
  if (!name || name.length > 160) throw new CustomerLocationError("validation", "Location name must contain 1 to 160 characters.");
  if (!timezone || timezone.length > 100) throw new CustomerLocationError("validation", "A valid IANA time zone is required.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new CustomerLocationError("validation", "A valid IANA time zone is required.");
  }
  return { name, timezone };
}

export function customerLocationAuthorizationFailure(input: {
  userFound: boolean;
  emailVerified: boolean;
  userDisabled: boolean;
  membershipRole: string | null;
  organizationArchived: boolean;
}): CustomerLocationCreationFailure | null {
  if (!input.userFound) return "unauthenticated";
  if (!input.emailVerified) return "unverified";
  if (input.userDisabled || input.membershipRole !== "owner") return "owner_required";
  if (input.organizationArchived) return "organization_unavailable";
  return null;
}

export function customerLocationDisplayNameKey(name: string): string {
  return name.trim().toLowerCase();
}
