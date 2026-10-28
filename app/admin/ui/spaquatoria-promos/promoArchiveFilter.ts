export type PromoArchiveFilter = "not_archived" | "archived" | "all";

export function filterPromoCodes<T extends { archivedAt: string | null }>(codes: T[], filter: PromoArchiveFilter): T[] {
  if (filter === "all") return codes;
  return codes.filter((code) => filter === "archived" ? code.archivedAt !== null : code.archivedAt === null);
}
