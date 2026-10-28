import { ContactEmailValidationError, normalizeContactEmail } from "../../../lib/v2/contactEmail";

export class OrganizationContactEmailError extends Error {
  constructor(readonly code: "validation" | "not_found", message: string) {
    super(message);
    this.name = "OrganizationContactEmailError";
  }
}

export async function updateOrganizationContactEmail(organizationId: string, value: unknown, write?: (id: string, email: string | null) => Promise<{ id: string; contactEmail: string | null } | null>) {
  let contactEmail: string | null;
  try { contactEmail = normalizeContactEmail(value); }
  catch (error) {
    if (error instanceof ContactEmailValidationError) throw new OrganizationContactEmailError("validation", error.message);
    throw error;
  }

  const update = write ?? (async (id: string, email: string | null) => {
    const [{ v2Db }, { organizations }, { eq }] = await Promise.all([import("../client"), import("../schema"), import("drizzle-orm")]);
    const [organization] = await v2Db.update(organizations).set({ contactEmail: email, updatedAt: new Date() })
      .where(eq(organizations.id, id)).returning({ id: organizations.id, contactEmail: organizations.contactEmail });
    return organization ?? null;
  });
  const organization = await update(organizationId, contactEmail);
  if (!organization) throw new OrganizationContactEmailError("not_found", "Organization was not found.");
  return organization;
}
