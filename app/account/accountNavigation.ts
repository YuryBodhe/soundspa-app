export type AccountNavigationSection = "salons" | "devices" | "subscriptions";

const sectionIds: Record<AccountNavigationSection, string> = {
  salons: "account-salons",
  devices: "account-devices",
  subscriptions: "account-subscriptions",
};

export function accountSectionId(section: AccountNavigationSection): string {
  return sectionIds[section];
}

export function accountSectionHref(section: AccountNavigationSection): string {
  return `/account#${accountSectionId(section)}`;
}

export function accountSectionIdFromHash(hash: string): string | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return Object.values(sectionIds).includes(id) ? id : null;
}
