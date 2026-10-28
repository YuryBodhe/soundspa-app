export type ContactOrganization = { name: string; contactEmail: string | null };

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
