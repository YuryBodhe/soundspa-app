import { v2Db } from "../client";
import { locations, organizations } from "../schema";

export type CustomerProvisioningInput = {
  organizationName: string;
  locationName: string;
  slug: string;
  timezone: string;
};

export class CustomerProvisioningError extends Error {
  constructor(readonly code: "validation" | "slug_conflict", message: string) {
    super(message);
    this.name = "CustomerProvisioningError";
  }
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new CustomerProvisioningError("validation", `${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed) throw new CustomerProvisioningError("validation", `${label} is required.`);
  if (trimmed.length > maxLength) throw new CustomerProvisioningError("validation", `${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

export function validateCustomerProvisioningInput(value: unknown): CustomerProvisioningInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomerProvisioningError("validation", "Customer and Location details are required.");
  }
  const input = value as Record<string, unknown>;
  const organizationName = requiredText(input.organizationName, "Organization name", 160);
  const locationName = requiredText(input.locationName, "Location name", 160);
  const slug = requiredText(input.slug, "Location slug", 100);
  const timezone = requiredText(input.timezone, "Time zone", 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new CustomerProvisioningError("validation", "Location slug must use lowercase letters, numbers, and single hyphens only.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new CustomerProvisioningError("validation", "Enter a valid IANA time zone, for example Europe/Moscow or UTC.");
  }
  return { organizationName, locationName, slug, timezone };
}

function isLocationSlugConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === "locations_slug_unique") return true;
    current = candidate.cause;
  }
  return false;
}

export async function createCustomerWithFirstLocation(value: unknown) {
  const input = validateCustomerProvisioningInput(value);
  try {
    return await v2Db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({ name: input.organizationName }).returning({
        id: organizations.id,
        name: organizations.name,
      });
      const [location] = await tx.insert(locations).values({
        organizationId: organization.id,
        name: input.locationName,
        slug: input.slug,
        timezone: input.timezone,
      }).returning({
        id: locations.id,
        name: locations.name,
        slug: locations.slug,
        timezone: locations.timezone,
      });
      return { organization, location };
    });
  } catch (error) {
    if (isLocationSlugConflict(error)) {
      throw new CustomerProvisioningError("slug_conflict", "That Location slug is already in use. Choose a different slug.");
    }
    throw error;
  }
}
