export type ContactOrganization = { name: string; contactEmail: string | null };
export type OwnerLoginEmailRow = { organizationId: string; email: string };

export function groupOwnerLoginEmails(organizationIds: readonly string[], rows: readonly OwnerLoginEmailRow[]): Map<string, string[]> {
  const emailsByOrganization = new Map<string, Map<string, string>>(organizationIds.map((id) => [id, new Map()]));
  for (const { organizationId, email } of rows) {
    const owners = emailsByOrganization.get(organizationId);
    const trimmedEmail = email.trim();
    if (!owners || !trimmedEmail) continue;
    const identity = trimmedEmail.toLowerCase();
    if (!owners.has(identity)) owners.set(identity, trimmedEmail);
  }
  return new Map([...emailsByOrganization].map(([id, owners]) => [
    id,
    [...owners.values()].sort((left, right) => {
      const normalizedLeft = left.toLowerCase();
      const normalizedRight = right.toLowerCase();
      return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : left < right ? -1 : left > right ? 1 : 0;
    }),
  ]));
}

export function filterOrganizationsByStatus<T extends { archived: boolean }>(organizations: T[], status: "active" | "archived" | "all"): T[] {
  return status === "all" ? organizations : organizations.filter((organization) => organization.archived === (status === "archived"));
}

export function filterOrganizations<T extends ContactOrganization>(organizations: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return organizations;
  return organizations.filter((organization) => `${organization.name}\n${organization.contactEmail ?? ""}`.toLocaleLowerCase().includes(normalized));
}

export function paginateOrganizations<T>(organizations: T[], page: number, pageSize = 20): { items: T[]; page: number; pageCount: number } {
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 20;
  const pageCount = Math.max(1, Math.ceil(organizations.length / safePageSize));
  const safePage = Math.min(pageCount, Math.max(1, Math.floor(page) || 1));
  return { items: organizations.slice((safePage - 1) * safePageSize, safePage * safePageSize), page: safePage, pageCount };
}
